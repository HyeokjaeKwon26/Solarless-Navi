/**
 * SOLARIS NAV - Main Application Controller
 * Pure 2D High-Performance Navigation System,
 * Dynamic Specific Route Voice Announcements ("최단 시간 경로로 안내를 시작합니다", "눈부심 방지 역광 회피 경로로 안내를 시작합니다", "그늘 우선 경로로 안내를 시작합니다"),
 * Real-Time GPS Solar Sunrise/Sunset & Elevation Dark Mode Synchronization,
 * Toll-Free Route Avoidance Option, High-Res Satellite Imagery Layer.
 */

document.addEventListener('DOMContentLoaded', () => {

    const DEFAULT_FAVORITES = [
        { id: "home", name: "Home", coords: null, icon: "fa-house" },
        { id: "work", name: "Work", coords: null, icon: "fa-briefcase" },
        { id: "mart", name: "Supermarket", coords: null, icon: "fa-cart-shopping" }
    ];

    let map = null;
    let lightTileLayerKo = null;
    let lightTileLayerEn = null;
    let darkTileLayer = null;
    let satelliteTileLayer = null;
    let currentTileLayer = null;

    let currentStart = null;
    let currentHeading = 0;
    let currentEnd = null;
    let destinationName = "";
    const SAVED_ROUTE_MODE_KEY = 'solarless_last_route_mode';
    let currentMode = 'glareFree';
    try {
        const savedMode = localStorage.getItem(SAVED_ROUTE_MODE_KEY);
        if (savedMode && ['glareFree', 'fastest', 'shade'].includes(savedMode)) {
            currentMode = savedMode;
        }
    } catch (e) {
        console.warn('localStorage read error:', e);
    }

    let isRealTimeMode = true;
    const nowD = new Date();
    let selectedTimeMinutes = nowD.getHours() * 60 + nowD.getMinutes();

    let compassMode = 'heading-up'; // 'heading-up' (standard default for vehicle navigation) | 'north-up'
    let isAutoDarkModeEnabled = true;
    let isTollFreeOnly = false;
    let isSatelliteViewActive = false;
    let isBatterySaverActive = false;

    let routeData = null;
    let selectedRouteObj = null;
    let activeRoutePolylineGroup = null;
    let startMarker = null;
    let endMarker = null;

    let isLiveNavActive = false;
    let gpsWatchId = null;
    let lastGpsPosition = null;
    let lastGpsTimestamp = null;
    let lastRerouteTime = 0;

    /* Free Map Panning & 8-Second Auto Recenter Toast Variables */
    let isUserMapPanning = false;
    let recenterWaitTimer = null;
    let recenterCountdownInterval = null;
    let countdownSecLeft = 3;

    let currentCountry = 'KR';
    let currentSpeedLimit = null; // null if no road speed limit data exists
    let lastSpeedLimitFetchTime = 0;
    let isSpeedingWarningActive = false;
    let lastSpeedingAnnounceTime = 0;
    let isAmbientLightDark = false;
    let isCurrentRoadTunnel = false;

    let gpsSunTimes = {
        sunriseMins: 360,
        noonMins: 750,
        sunsetMins: 1180
    };

    function getRouteAnnouncementText(mode, isReroute = false) {
        const isKo = I18n.getLanguage().startsWith('ko');
        let targetRoute = null;
        if (routeData && routeData.routes) {
            targetRoute = routeData.routes[mode];
        }
        if (!targetRoute && selectedRouteObj) {
            targetRoute = selectedRouteObj;
        }

        const uvCut = (targetRoute && typeof targetRoute.uvReductionPct === 'number') ? targetRoute.uvReductionPct : 0;
        const isNight = targetRoute && targetRoute.isNight;

        let modeNameKo = "역광 회피 경로";
        let modeNameEn = "glare-free route";

        if (mode === 'fastest') {
            modeNameKo = "최단 시간 경로";
            modeNameEn = "fastest route";
            if (isReroute) {
                return isKo ? "최단 시간 경로로 새로 탐색하여 안내를 시작합니다." : "Rerouting guidance to the fastest route.";
            } else {
                return isKo ? "최단 시간 경로로 안내를 시작합니다." : "Starting navigation on the fastest route.";
            }
        } else if (mode === 'shade') {
            modeNameKo = "그늘 우선 경로";
            modeNameEn = "shade-priority route";
        } else {
            modeNameKo = "역광 회피 경로";
            modeNameEn = "glare-free route";
        }

        if (uvCut > 0 && !isNight) {
            if (isReroute) {
                return isKo ?
                    `자외선 노출을 ${uvCut}% 줄인 ${modeNameKo}로 새로 탐색하여 안내를 시작합니다.` :
                    `Rerouting guidance to ${modeNameEn}, reducing UV exposure by ${uvCut}%.`;
            } else {
                return isKo ?
                    `자외선 노출을 ${uvCut}% 줄인 ${modeNameKo}로 안내를 시작합니다.` :
                    `Starting guidance on ${modeNameEn}, reducing UV exposure by ${uvCut}%.`;
            }
        } else {
            if (isReroute) {
                return isKo ?
                    `${modeNameKo}로 새로 탐색하여 안내를 시작합니다.` :
                    `Rerouting guidance to ${modeNameEn}.`;
            } else {
                return isKo ?
                    `${modeNameKo}로 안내를 시작합니다.` :
                    `Starting guidance on ${modeNameEn}.`;
            }
        }
    }

    function initMap() {
        document.getElementById('time-slider').value = selectedTimeMinutes;

        const hasStartCoords = (currentStart && typeof currentStart.lat === 'number' && typeof currentStart.lng === 'number');
        const initialLat = hasStartCoords ? currentStart.lat : 0;
        const initialLng = hasStartCoords ? currentStart.lng : 0;
        const initialZoom = hasStartCoords ? 16 : 2;

        map = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView([initialLat, initialLng], initialZoom);

        // Korean Localized Tile Layer: ESRI World Street Map (Korean place names)
        lightTileLayerKo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        });

        // English Tile Layer: CartoDB Voyager High-Contrast Navigation
        lightTileLayerEn = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        });

        // Dark Theme: CartoDB Dark Matter High-Contrast Night Navigation
        darkTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        });

        // High-Resolution Satellite Photo Tile Layer: ESRI World Imagery
        satelliteTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        });

        currentTileLayer = lightTileLayerKo;
        currentTileLayer.addTo(map);

        OfflineMap.registerOfflineTileCache(lightTileLayerKo);
        OfflineMap.registerOfflineTileCache(lightTileLayerEn);

        activeRoutePolylineGroup = L.featureGroup().addTo(map);

        disableMapEventsOnUI();

        setupHardwareBackButtonHandler();
        setupAppResumeListener();
        setupDrawerSwipeDownToDismiss();
        setupFeatureListeners();
        setupMapPanTrackingListeners();
        initAmbientLightSensor();

        const currentLang = I18n.getLanguage();
        const flagSpan = document.getElementById('lang-flag');
        const textSpan = document.getElementById('lang-text');
        if (currentLang.startsWith('en')) {
            if (flagSpan) flagSpan.innerText = '🇺🇸';
            if (textSpan) textSpan.innerText = 'EN';
        } else {
            if (flagSpan) flagSpan.innerText = '🇰🇷';
            if (textSpan) textSpan.innerText = 'KO';
        }

        I18n.applyUiLanguage();
        updateSunInfo();
        renderFavorites();
        renderRecentDestinationHistory();
        updateModeButtonsHighlight();
        requestUserGpsLocation(true);

        setTimeout(checkGitHubLatestVersion, 2500);
    }

    /* MAP PANNING TRACKING & 25-SECOND AUTO RECENTER COUNTDOWN TOAST */
    function resetRecenterInactivityTimer() {
        clearTimeout(recenterWaitTimer);
        clearInterval(recenterCountdownInterval);
        hideRecenterToast();

        if (!isLiveNavActive || !isUserMapPanning) return;

        // If sidebar drawer is active or modal is open, do NOT trigger countdown
        const sidebar = document.getElementById('sidebar-panel');
        if (sidebar && sidebar.classList.contains('active')) return;
        const hasOpenModal = document.querySelector('.modal.active, .start-search-card:not(.hidden)');
        if (hasOpenModal) return;

        // 25-second timer of panning without user interaction -> trigger 3s countdown toast
        recenterWaitTimer = setTimeout(triggerRecenterCountdownToast, 25000);
    }

    function setupMapPanTrackingListeners() {
        if (!map) return;

        const onUserPan = () => {
            if (!isLiveNavActive) return;

            isUserMapPanning = true;
            const btnGps = document.getElementById('btn-recenter-gps');
            if (btnGps) btnGps.classList.add('panned');

            // Temporarily reset DOM transform while user is panning so touch drag direction matches screen fingers
            const mapElement = document.getElementById('map');
            if (mapElement) mapElement.style.transform = 'none';

            resetRecenterInactivityTimer();
        };

        map.on('dragstart', onUserPan);
        map.on('movestart', (e) => {
            if (e.originalEvent) onUserPan();
        });

        // Global touch/pointer listener to keep user uninterrupted when touching any menu, button, or drawer!
        const onAnyUserInteraction = () => {
            if (isLiveNavActive && isUserMapPanning) {
                resetRecenterInactivityTimer();
            }
        };
        document.addEventListener('touchstart', onAnyUserInteraction, { passive: true });
        document.addEventListener('mousedown', onAnyUserInteraction, { passive: true });

        const btnRecenterToast = document.getElementById('btn-recenter-now-toast');
        if (btnRecenterToast) {
            btnRecenterToast.addEventListener('click', recenterMapToVehicle);
        }
    }

    function triggerRecenterCountdownToast() {
        if (!isUserMapPanning || !isLiveNavActive) return;

        // Do NOT trigger countdown if user is viewing sidebar drawer or modal!
        const sidebar = document.getElementById('sidebar-panel');
        if (sidebar && sidebar.classList.contains('active')) return;
        const hasOpenModal = document.querySelector('.modal.active, .start-search-card:not(.hidden)');
        if (hasOpenModal) return;

        const toast = document.getElementById('recenter-toast-banner');
        const numText = document.getElementById('recenter-timer-num');
        const titleText = document.getElementById('recenter-toast-title');
        const subText = document.getElementById('recenter-toast-sub');
        const nowBtnLbl = document.getElementById('recenter-now-lbl');
        const progressRing = document.getElementById('timer-ring-progress');

        const isKo = I18n.getLanguage().startsWith('ko');

        if (titleText) titleText.innerText = I18n.getText('recenterToastTitle');
        if (nowBtnLbl) nowBtnLbl.innerText = I18n.getText('recenterNow');

        countdownSecLeft = 3;
        if (numText) numText.innerText = countdownSecLeft;
        if (subText) subText.innerText = isKo ? `3초 후 차량 위치 중심으로 자동 복귀합니다.` : `Auto-recentering map in 3 seconds.`;

        if (progressRing) progressRing.style.strokeDasharray = '100, 100';
        if (toast) toast.classList.remove('hidden');

        clearInterval(recenterCountdownInterval);
        recenterCountdownInterval = setInterval(() => {
            // Cancel countdown if user opened sidebar drawer
            const curSidebar = document.getElementById('sidebar-panel');
            if (curSidebar && curSidebar.classList.contains('active')) {
                clearInterval(recenterCountdownInterval);
                hideRecenterToast();
                return;
            }

            countdownSecLeft--;

            if (numText) numText.innerText = Math.max(0, countdownSecLeft);
            if (subText) subText.innerText = isKo ? `${countdownSecLeft}초 후 차량 위치 중심으로 자동 복귀합니다.` : `Auto-recentering map in ${countdownSecLeft} seconds.`;

            if (progressRing) {
                const pct = (countdownSecLeft / 3) * 100;
                progressRing.style.strokeDasharray = `${pct}, 100`;
            }

            if (countdownSecLeft <= 0) {
                clearInterval(recenterCountdownInterval);
                recenterMapToVehicle();
            }
        }, 1000);
    }

    function recenterMapToVehicle() {
        isUserMapPanning = false;
        clearTimeout(recenterWaitTimer);
        clearInterval(recenterCountdownInterval);
        hideRecenterToast();

        // Close sidebar drawer when recentering so driver returns to clear navigation view
        const sidebar = document.getElementById('sidebar-panel');
        if (sidebar) sidebar.classList.remove('active');

        const btnGps = document.getElementById('btn-recenter-gps');
        if (btnGps) btnGps.classList.remove('panned');

        if (map && currentStart) {
            map.setView([currentStart.lat, currentStart.lng], 17, { animate: true });
            applyMapRotation(currentHeading);
        }
    }

    function hideRecenterToast() {
        const toast = document.getElementById('recenter-toast-banner');
        if (toast) toast.classList.add('hidden');
    }

    function setupFeatureListeners() {
        // Top Left Logo & Top Right Settings Button Listeners
        const btnHeaderHome = document.getElementById('btn-header-home');
        const btnMobileToggle = document.getElementById('mobile-toggle-panel');

        const toggleSidebar = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const sidebar = document.getElementById('sidebar-panel');
            if (sidebar) {
                const isOpening = !sidebar.classList.contains('active');
                sidebar.classList.toggle('active');
                if (isOpening) {
                    clearTimeout(recenterWaitTimer);
                    clearInterval(recenterCountdownInterval);
                    hideRecenterToast();
                } else {
                    if (isUserMapPanning && isLiveNavActive) {
                        resetRecenterInactivityTimer();
                    }
                }
            }
        };

        if (btnMobileToggle) {
            btnMobileToggle.addEventListener('click', toggleSidebar);
            btnMobileToggle.addEventListener('touchstart', toggleSidebar, { passive: false });
        }

        if (btnHeaderHome) {
            btnHeaderHome.addEventListener('click', () => openSearchModal());
        }

        // OLED Heat & Battery Saver Mode Toggle Button
        const btnSaver = document.getElementById('btn-toggle-battery-saver');
        if (btnSaver) {
            btnSaver.addEventListener('click', toggleBatterySaverMode);
        }

        // Auto Dark Mode Toggle Checkbox
        const chkAutoDark = document.getElementById('toggle-auto-dark');
        if (chkAutoDark) {
            chkAutoDark.addEventListener('change', (e) => {
                isAutoDarkModeEnabled = e.target.checked;
                checkAndUpdateMapTileTheme();
            });
        }

        // Toll-Free Route Avoidance Toggle Checkbox
        const chkTollFree = document.getElementById('toggle-toll-free');
        if (chkTollFree) {
            chkTollFree.addEventListener('change', (e) => {
                isTollFreeOnly = e.target.checked;
                const isKo = I18n.getLanguage().startsWith('ko');
                TTSVoice.speak(isTollFreeOnly ?
                    (isKo ? "무료 도로 우선 탐색이 설정되었습니다." : "Toll-free route preference enabled.") :
                    (isKo ? "일반 도로 탐색으로 전환합니다." : "Standard routing enabled."));

                if (currentEnd) {
                    updateRoute();
                }
            });
        }

        // High-Res Satellite View Toggle Checkbox
        const chkSatellite = document.getElementById('toggle-satellite-view');
        if (chkSatellite) {
            chkSatellite.addEventListener('change', (e) => {
                isSatelliteViewActive = e.target.checked;
                checkAndUpdateMapTileTheme();
                const isKo = I18n.getLanguage().startsWith('ko');
                TTSVoice.speak(isSatelliteViewActive ?
                    (isKo ? "고화질 위성 사진 지도로 전환합니다." : "Switched to satellite photo view.") :
                    (isKo ? "일반 내비게이션 지도로 전환합니다." : "Switched to standard navigation map."));
            });
        }

        // Shaded Rest Spot Search Button
        const btnRest = document.getElementById('btn-find-shaded-rest');
        if (btnRest) {
            btnRest.addEventListener('click', searchNearbyShadedRestSpots);
        }

        // About App Modal Listeners (Front-Most Z-Index 9000 Layer)
        const btnAbout = document.getElementById('btn-about-app');
        const modalAbout = document.getElementById('about-app-modal');
        const btnCloseAbout = document.getElementById('btn-close-about-modal');

        if (btnAbout && modalAbout) {
            btnAbout.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                modalAbout.classList.remove('hidden');
            });
        }
        if (btnCloseAbout && modalAbout) {
            btnCloseAbout.addEventListener('click', () => {
                modalAbout.classList.add('hidden');
            });
        }

        const btnCloseUpdate = document.getElementById('btn-close-update-modal');
        const modalUpdate = document.getElementById('update-modal');
        if (btnCloseUpdate && modalUpdate) {
            btnCloseUpdate.addEventListener('click', () => {
                modalUpdate.classList.add('hidden');
            });
        }

        // 1-Tap Quick Language Toggle Button (KO <-> EN)
        const btnLang = document.getElementById('btn-toggle-lang');
        if (btnLang) {
            btnLang.addEventListener('click', () => {
                const current = I18n.getLanguage();
                const nextLang = current.startsWith('ko') ? 'en-US' : 'ko-KR';

                const flagSpan = document.getElementById('lang-flag');
                const textSpan = document.getElementById('lang-text');

                if (nextLang.startsWith('en')) {
                    if (flagSpan) flagSpan.innerText = '🇺🇸';
                    if (textSpan) textSpan.innerText = 'EN';
                } else {
                    if (flagSpan) flagSpan.innerText = '🇰🇷';
                    if (textSpan) textSpan.innerText = 'KO';
                }

                I18n.setLanguage(nextLang);
                TTSVoice.setLanguage(nextLang);

                // Dynamically update solar info and buttons in new language
                updateSunInfo();

                // Dynamically Switch Map Tiles to match KO / EN Language
                checkAndUpdateMapTileTheme();

                // Refresh Compass Mode Tag Text
                const compassTag = document.getElementById('compass-mode-tag');
                if (compassTag) {
                    compassTag.innerText = isHeadingUpMode ? I18n.getText('compassHeading') : I18n.getText('compassNorth');
                }

                // Update Mobile Turn Banner Language if Active
                updateTurnBannerText(300, currentHeading, 0.05);

                // Refresh Active Route Cards & Summary Text if Routes Exist
                if (routeData) {
                    updateRouteOptionButtons(routeData);
                    if (selectedRouteObj) {
                        updateSummaryBox(selectedRouteObj);
                    }
                }

                // Update Start Nav Buttons Text
                const liveBtn = document.getElementById('live-gps-nav-btn');
                const directMapBtn = document.getElementById('btn-map-start-nav');
                if (liveBtn) {
                    liveBtn.innerHTML = isLiveNavActive ?
                        `<i class="fa-solid fa-square"></i> ${I18n.getText('liveNavStop')}` :
                        `<i class="fa-solid fa-location-arrow"></i> ${I18n.getText('liveNavStart')}`;
                }
                if (directMapBtn) {
                    directMapBtn.innerHTML = isLiveNavActive ?
                        `<i class="fa-solid fa-square"></i> ${I18n.getText('mapStopNav')}` :
                        `<i class="fa-solid fa-play"></i> ${I18n.getText('mapStartNav')}`;
                }

                renderFavorites();
                renderRecentDestinationHistory();

                const msg = nextLang.startsWith('ko') ?
                    "한국어 지도 및 음성 안내가 설정되었습니다." :
                    "English map and voice guidance activated.";
                TTSVoice.speak(msg, true);
            });
        }
    }

    /* TURN BANNER FULL INTERNATIONALIZATION (KO <-> EN) WITH ACCURATE DISTANCE & INSTRUCTION */
    function updateTurnBannerText(distMeters, heading, glareRisk) {
        const banner = document.getElementById('mobile-turn-banner');
        if (!banner) return;

        const isKo = I18n.getLanguage().startsWith('ko');
        const bannerDist = document.getElementById('banner-dist');
        const bannerDesc = document.getElementById('banner-desc');
        const bannerIcon = document.getElementById('banner-turn-icon');

        const formattedDist = distMeters > 0 ? (distMeters >= 1000 ? (distMeters/1000).toFixed(1) + 'km' : Math.round(distMeters) + 'm') : '300m';
        const distPrefix = isKo ? `${formattedDist} 앞` : `In ${formattedDist}`;

        if (bannerDist) bannerDist.innerText = distPrefix;

        if (glareRisk > 0.45) {
            if (bannerDesc) bannerDesc.innerText = isKo ? `⚠️ 전방 역광 위험! (${Math.round(heading)}° 직사광선)` : `⚠️ Sun Glare Warning! (Direct sun at ${Math.round(heading)}°)`;
            banner.classList.add('hazard');
            if (bannerIcon) bannerIcon.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`;
        } else {
            if (bannerDesc) bannerDesc.innerText = isKo ? `안전 주행 중 (태양 각도 쾌적 ${Math.round(glareRisk * 100)}%)` : `Safe Driving (Comfortable sun angle ${Math.round(glareRisk * 100)}%)`;
            banner.classList.remove('hazard');
            if (bannerIcon) bannerIcon.innerHTML = `<i class="fa-solid fa-arrow-turn-up"></i>`;
        }
    }

    /* HARDWARE AMBIENT LIGHT SENSOR & TUNNEL DETECTION FOR AUTO DARK THEME */
    function initAmbientLightSensor() {
        if ('AmbientLightSensor' in window) {
            try {
                const sensor = new AmbientLightSensor({ frequency: 1 });
                sensor.onreading = () => {
                    // Under 30 lux indicates tunnel/indoor/dark underground parking
                    if (sensor.illuminance < 30) {
                        if (!isAmbientLightDark) {
                            isAmbientLightDark = true;
                            checkAndUpdateMapTileTheme();
                        }
                    } else if (sensor.illuminance > 80) {
                        if (isAmbientLightDark) {
                            isAmbientLightDark = false;
                            checkAndUpdateMapTileTheme();
                        }
                    }
                };
                sensor.onerror = (e) => {
                    console.log("AmbientLightSensor notice:", e.error);
                };
                sensor.start();
            } catch (err) {
                console.log("AmbientLightSensor init notice:", err);
            }
        }

        // Fallback for devices supporting devicelight event
        window.addEventListener('devicelight', (e) => {
            if (e.value < 30) {
                if (!isAmbientLightDark) {
                    isAmbientLightDark = true;
                    checkAndUpdateMapTileTheme();
                }
            } else if (e.value > 80) {
                if (isAmbientLightDark) {
                    isAmbientLightDark = false;
                    checkAndUpdateMapTileTheme();
                }
            }
        });
    }

    /* REAL-TIME DYNAMIC GPS SUNCALC ASTRONOMICAL SUNRISE/SUNSET & TUNNEL/LIGHT DARK MODE SWITCHING */
    function checkAndUpdateMapTileTheme() {
        let targetTileLayer = null;

        if (isSatelliteViewActive) {
            targetTileLayer = satelliteTileLayer;
        } else {
            const lang = I18n.getLanguage();
            const isKo = lang.startsWith('ko');
            targetTileLayer = isKo ? lightTileLayerKo : lightTileLayerEn;

            if (isAutoDarkModeEnabled) {
                const dateObj = isRealTimeMode ? new Date() : getDateFromMinutes(selectedTimeMinutes);
                let evalLat = null;
                let evalLng = null;
                if (currentStart && typeof currentStart.lat === 'number') {
                    evalLat = currentStart.lat;
                    evalLng = currentStart.lng;
                } else if (map && map.getCenter) {
                    const center = map.getCenter();
                    if (center && typeof center.lat === 'number') {
                        evalLat = center.lat;
                        evalLng = center.lng;
                    }
                }

                let isNight = false;
                if (evalLat !== null && evalLng !== null && (evalLat !== 0 || evalLng !== 0)) {
                    const sunPos = SunCalc.getPosition(dateObj, evalLat, evalLng);
                    // Auto Dark Mode triggers when sun altitude is below horizon (sunPos.altitude < -0.02)
                    isNight = (sunPos.altitude < -0.02);
                }

                // 3-Pillar Hybrid Dark Mode: Night Time OR OSM Road Tunnel Tag OR Hardware Ambient Light Sensor
                const isDarkTheme = isNight || isCurrentRoadTunnel || isAmbientLightDark;
                if (isDarkTheme) {
                    targetTileLayer = darkTileLayer;
                }
            }
        }

        if (currentTileLayer !== targetTileLayer) {
            if (currentTileLayer && map.hasLayer(currentTileLayer)) {
                map.removeLayer(currentTileLayer);
            }
            currentTileLayer = targetTileLayer;
            currentTileLayer.addTo(map);
        }
    }

    /* OLED HEAT & BATTERY SAVER MODE TOGGLE */
    function toggleBatterySaverMode() {
        isBatterySaverActive = !isBatterySaverActive;
        const btn = document.getElementById('btn-toggle-battery-saver');

        if (isBatterySaverActive) {
            document.body.classList.add('battery-saver-active');
            if (btn) btn.classList.add('active');
            TTSVoice.speak(I18n.getLanguage().startsWith('ko') ? "배터리 및 발열 절전 주행 모드가 켜졌습니다." : "Battery saver mode activated.", true);
        } else {
            document.body.classList.remove('battery-saver-active');
            if (btn) btn.classList.remove('active');
            TTSVoice.speak(I18n.getLanguage().startsWith('ko') ? "절전 주행 모드가 꺼졌습니다." : "Battery saver mode deactivated.", true);
        }
    }

    /* SHADED REST SPOT & PARKING WAYPOINT SEARCH */
    async function searchNearbyShadedRestSpots() {
        const btn = document.getElementById('btn-find-shaded-rest');
        if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${I18n.getText('shadedRestBtn')}</span>`;

        const restQuery = "parking garage rest stop shelter 쉼터 주차장";
        const results = await Geocoder.searchPlaces(restQuery, currentStart);

        if (btn) btn.innerHTML = `<i class="fa-solid fa-umbrella"></i> <span>${I18n.getText('shadedRestBtn')}</span>`;

        const isKo = I18n.getLanguage().startsWith('ko');

        if (results && results.length > 0) {
            const nearest = results[0];
            const distKm = nearest.distKm ? nearest.distKm.toFixed(1) : "0.5";
            const confirmMsg = isKo ?
                `☕ 근처 그늘 쉼터 발견!\n\n장소: ${nearest.shortTitle || nearest.displayName}\n거리: 약 ${distKm}km\n\n이 그늘 쉼터를 경유지로 지정하시겠습니까?` :
                `☕ Nearby Shaded Rest Area Found!\n\nPlace: ${nearest.shortTitle || nearest.displayName}\nDistance: ~${distKm}km\n\nSet this shaded spot as your waypoint?`;

            const confirmWaypoint = confirm(confirmMsg);

            if (confirmWaypoint) {
                currentEnd = { lat: nearest.lat, lng: nearest.lng };
                destinationName = `☕ ${isKo ? '그늘 쉼터' : 'Shaded Rest'}: ${nearest.shortTitle || nearest.displayName}`;
                document.getElementById('destination-input').value = destinationName;
                document.getElementById('bar-dest-text').innerText = destinationName;
                updateRoute();
                TTSVoice.speak(isKo ? "근처 그늘 쉼터로 경로를 변경했습니다." : "Route updated to nearby shaded rest area.");
            }
        } else {
            alert(isKo ? "현재 위치 주변 2km 이내에 등록된 그늘 쉼터/주차장을 찾을 수 없습니다." : "No shaded rest spots found within 2km.");
        }
    }

    /* DYNAMIC FAVORITE DESTINATIONS MODULE (localStorage) */
    function getFavorites() {
        try {
            const data = localStorage.getItem('solaris_favorites');
            if (data) {
                const parsed = JSON.parse(data);
                if (parsed && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return DEFAULT_FAVORITES;
    }

    function saveFavoritesList(list) {
        try {
            localStorage.setItem('solaris_favorites', JSON.stringify(list));
        } catch (e) {}
        renderFavorites();
    }

    function getLocalizedFavName(fav) {
        const isKo = I18n.getLanguage().startsWith('ko');
        const id = fav.id || '';
        const rawName = fav.name || '';
        if (id === 'home' || rawName.includes('집') || rawName.includes('Home')) return isKo ? '🏠 집' : '🏠 Home';
        if (id === 'work' || rawName.includes('회사') || rawName.includes('Work') || rawName.includes('Office')) return isKo ? '🏢 회사' : '🏢 Work';
        if (id === 'mart' || rawName.includes('마트') || rawName.includes('Mart') || rawName.includes('쇼핑몰') || rawName.includes('Mall') || rawName.includes('Supermarket')) return isKo ? '🛒 마트/쇼핑몰' : '🛒 Supermarket';
        return rawName;
    }

    function renderFavorites() {
        const container = document.getElementById('favorite-chips-group');
        if (!container) return;

        const isKo = I18n.getLanguage().startsWith('ko');
        const favs = getFavorites();
        container.innerHTML = '';

        favs.forEach(fav => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'fav-chip-btn';
            const iconClass = fav.icon || 'fa-star';
            const displayName = getLocalizedFavName(fav);
            chip.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${displayName}</span>`;

            chip.addEventListener('click', async () => {
                const targetName = getLocalizedFavName(fav);
                if (fav.coords) {
                    currentEnd = fav.coords;
                    destinationName = targetName;
                    document.getElementById('destination-input').value = targetName;
                    document.getElementById('btn-confirm-destination').disabled = false;
                    startNavigationFlow();
                } else {
                    const promptName = getLocalizedFavName(fav);
                    const place = prompt(isKo ? `'${promptName}'의 주소나 장소명을 입력하고 즐겨찾기로 등록하세요:` : `Enter address or place name to register '${promptName}':`);
                    if (place && place.trim()) {
                        const btn = document.getElementById('btn-confirm-destination');
                        if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${isKo ? '장소 확인 중...' : 'Verifying place...'}`;

                        const results = await Geocoder.searchPlaces(place.trim(), currentStart);
                        if (results && results.length > 0) {
                            fav.coords = { lat: results[0].lat, lng: results[0].lng };
                            fav.name = `${promptName.split('(')[0].trim()} (${(results[0].shortTitle || results[0].displayName).split(',')[0]})`;
                            saveFavoritesList(favs);

                            currentEnd = fav.coords;
                            destinationName = results[0].shortTitle || results[0].displayName;
                            document.getElementById('destination-input').value = destinationName;
                            document.getElementById('btn-confirm-destination').disabled = false;
                            startNavigationFlow();
                        } else {
                            if (btn) btn.innerHTML = `<i class="fa-solid fa-route"></i> ${I18n.getText('confirmStartBtn')}`;
                            alert(isKo ? `'${place}' 장소를 찾을 수 없습니다. 정확한 주소를 입력해 주세요.` : `Cannot find place '${place}'. Please enter a valid address.`);
                        }
                    }
                }
            });

            container.appendChild(chip);
        });

        // Add Quick Favorite Button
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'fav-chip-btn add-btn';
        addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> <span>${I18n.getText('addFavBtn')}</span>`;
        addBtn.addEventListener('click', async () => {
            const name = prompt(isKo ? "즐겨찾기 장소 별칭을 입력하세요 (예: 할머니댁, 자주가는 카페):" : "Enter a nickname for this favorite place (e.g. Grandma's, Favorite Cafe):");
            if (!name) return;
            const addr = prompt(isKo ? `'${name}'의 주소 또는 건물명을 입력하세요:` : `Enter address or building name for '${name}':`);
            if (!addr) return;

            const results = await Geocoder.searchPlaces(addr.trim(), currentStart);
            if (results && results.length > 0) {
                const list = getFavorites();
                list.push({
                    name: `⭐ ${name.trim()}`,
                    coords: { lat: results[0].lat, lng: results[0].lng },
                    icon: 'fa-location-dot'
                });
                saveFavoritesList(list);
                alert(isKo ? `'${name}' 즐겨찾기가 추가되었습니다!` : `Favorite '${name}' added successfully!`);
            } else {
                alert(isKo ? `'${addr}' 장소를 찾을 수 없습니다. 주소를 다시 확인해 주세요.` : `Cannot find place '${addr}'. Please verify the address.`);
            }
        });
        container.appendChild(addBtn);
    }

    /* MOBILE BOTTOM SHEET SWIPE DOWN TO DISMISS ONLY ON TOP DRAG HANDLE */
    function setupDrawerSwipeDownToDismiss() {
        const sidebar = document.getElementById('sidebar-panel');
        const dragHandle = document.getElementById('drawer-drag-handle');
        if (!sidebar || !dragHandle) return;

        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        const handleTouchStart = (e) => {
            if (!sidebar.classList.contains('active')) return;
            const touch = e.touches[0];
            startY = touch.clientY;
            currentY = startY;
            isDragging = true;
            sidebar.style.transition = 'none';
        };

        const handleTouchMove = (e) => {
            if (!isDragging) return;
            const touch = e.touches[0];
            currentY = touch.clientY;
            const deltaY = currentY - startY;

            if (deltaY > 0) {
                sidebar.style.transform = `translateY(${deltaY}px)`;
            }
        };

        const handleTouchEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            sidebar.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

            const deltaY = currentY - startY;
            if (deltaY > 45) {
                sidebar.classList.remove('active');
                sidebar.style.transform = '';
            } else {
                sidebar.style.transform = '';
            }
        };

        dragHandle.addEventListener('touchstart', handleTouchStart, { passive: true });
        dragHandle.addEventListener('touchmove', handleTouchMove, { passive: true });
        dragHandle.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    /* RECENT DESTINATION SEARCH HISTORY (localStorage) */
    function getDestinationHistory() {
        try {
            const data = localStorage.getItem('solaris_dest_history');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    function saveDestinationHistory(name, coords) {
        if (!name || !coords) return;
        let list = getDestinationHistory();
        list = list.filter(item => item.name !== name);
        list.unshift({
            name: name,
            coords: coords,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        if (list.length > 8) list = list.slice(0, 8);
        try {
            localStorage.setItem('solaris_dest_history', JSON.stringify(list));
        } catch (e) {}
        renderRecentDestinationHistory();
    }

    function removeDestinationHistoryItem(name) {
        let list = getDestinationHistory();
        list = list.filter(item => item.name !== name);
        try {
            localStorage.setItem('solaris_dest_history', JSON.stringify(list));
        } catch (e) {}
        renderRecentDestinationHistory();
    }

    function clearDestinationHistory() {
        try {
            localStorage.removeItem('solaris_dest_history');
        } catch (e) {}
        renderRecentDestinationHistory();
    }

    function renderRecentDestinationHistory() {
        const container = document.getElementById('recent-history-list');
        const section = document.getElementById('recent-history-group');
        if (!container || !section) return;

        const list = getDestinationHistory();
        if (list.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = '';

        list.forEach(item => {
            const row = document.createElement('div');
            row.className = 'history-item';
            const isKo = I18n.getLanguage().startsWith('ko');
            row.innerHTML = `
                <div class="history-item-info">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    <span class="history-item-name">${item.name}</span>
                </div>
                <button type="button" class="remove-history-btn" title="${isKo ? '삭제' : 'Delete'}"><i class="fa-solid fa-xmark"></i></button>
            `;

            row.querySelector('.history-item-info').addEventListener('click', () => {
                currentEnd = item.coords;
                destinationName = item.name;
                document.getElementById('destination-input').value = item.name;
                document.getElementById('btn-confirm-destination').disabled = false;
                startNavigationFlow();
            });

            row.querySelector('.remove-history-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                removeDestinationHistoryItem(item.name);
            });

            container.appendChild(row);
        });
    }

    function enableKeepAwake() {
        try {
            if (navigator.wakeLock) {
                navigator.wakeLock.request('screen').catch(e => {});
            }
        } catch (e) {
            console.warn("KeepAwake warning:", e);
        }
    }

    function disableKeepAwake() {}

    function setupAppResumeListener() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
                if (state.isActive && currentEnd) {
                    console.log("App resumed to foreground. Recalculating route from live GPS...");
                    requestUserGpsLocation(false);
                }
            });
        }
    }

    function setupHardwareBackButtonHandler() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.addListener('backButton', () => {
                handleHardwareBackButton();
            });
        }

        window.addEventListener('popstate', (e) => {
            handleHardwareBackButton();
        });
    }

    function handleHardwareBackButton() {
        const isKo = I18n.getLanguage().startsWith('ko');

        if (isLiveNavActive) {
            const confirmExit = confirm(isKo ? "경로 안내를 종료하시겠습니까?" : "Exit route navigation?");
            if (confirmExit) {
                toggleLiveGpsNavigation();
                openSearchModal();
            }
            return;
        }

        const sidebar = document.getElementById('sidebar-panel');
        if (sidebar && sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
            return;
        }

        const startModal = document.getElementById('start-search-modal');
        if (startModal && startModal.classList.contains('hidden')) {
            openSearchModal();
            return;
        }

        const exitApp = confirm(isKo ? "SolarLess Navi 앱을 종료하시겠습니까?" : "Exit SolarLess Navi app?");
        if (exitApp && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.exitApp();
        }
    }

    /* DISABLE LEAFLET MAP EVENT PROPAGATION WITHOUT BLOCKING NATIVE TOUCH SCROLL */
    function disableMapEventsOnUI() {
        const clickOnlyUis = [
            'sidebar-panel',
            'map-top-bar',
            'route-summary-box',
            'speedometer-bottom-left',
            'btn-recenter-gps',
            'btn-toggle-compass',
            'btn-toggle-battery-saver',
            'mobile-toggle-panel'
        ];

        clickOnlyUis.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                L.DomEvent.disableClickPropagation(el);
            }
        });

        const fullDisableUis = [
            'start-search-modal',
            'about-app-modal'
        ];
        fullDisableUis.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                L.DomEvent.disableClickPropagation(el);
                L.DomEvent.disableScrollPropagation(el);
            }
        });
    }

    /* GPS LOCATION REQUEST & DISCONNECT WARNING INDICATOR */
    function setGpsStatusIndicator(isLocating, isConnected) {
        const dot = document.getElementById('gps-dot');
        const warnIcon = document.getElementById('gps-warning-icon');

        if (isLocating) {
            if (dot) dot.style.display = 'none';
            if (warnIcon) warnIcon.classList.remove('hidden');
        } else if (isConnected) {
            if (dot) {
                dot.style.display = 'block';
                dot.classList.add('active');
            }
            if (warnIcon) warnIcon.classList.add('hidden');
        } else {
            if (dot) dot.style.display = 'none';
            if (warnIcon) warnIcon.classList.remove('hidden');
        }
    }

    function requestUserGpsLocation(isInitial = false) {
        if (!navigator.geolocation) {
            setGpsStatusIndicator(false, false);
            return;
        }

        setGpsStatusIndicator(true, false);

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
                    currentHeading = pos.coords.heading;
                }

                currentStart = { lat: lat, lng: lng };
                setGpsStatusIndicator(false, true);

                const addr = await Geocoder.reverseGeocode(lat, lng);
                const input = document.getElementById('origin-input');
                const myLocLabel = I18n.getLanguage().startsWith('ko') ? "🎯 내 위치" : "🎯 My Location";
                if (input) input.value = `${myLocLabel}: ${addr}`;

                updateSunInfo();
                checkAndUpdateMapTileTheme();

                if (currentEnd) {
                    updateRoute();
                } else {
                    map.setView([lat, lng], 16);
                    updateVehicleMarkerPosition(lat, lng, currentHeading);
                }
            },
            (err) => {
                setGpsStatusIndicator(false, false);
                if (isInitial) {
                    document.getElementById('origin-input').value = I18n.getLanguage().startsWith('ko') ? "🎯 내 위치 (현재 GPS)" : "🎯 My Location (Current GPS)";
                }
                updateSunInfo();
                checkAndUpdateMapTileTheme();
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    }

    let currentSmoothLat = null;
    let currentSmoothLng = null;
    let currentSmoothHeading = 0;
    let targetSnapLat = null;
    let targetSnapLng = null;
    let targetSnapHeading = 0;
    let vehicleAnimFrameId = null;
    let lastAppliedMapRotation = null;
    let stableGpsHeading = 0;
    let lastStableMovingGps = null;

    function startVehicleMarkerAnimationLoop() {
        if (vehicleAnimFrameId) return;

        function animateFrame() {
            if (targetSnapLat !== null && targetSnapLng !== null) {
                if (currentSmoothLat === null || currentSmoothLng === null) {
                    currentSmoothLat = targetSnapLat;
                    currentSmoothLng = targetSnapLng;
                    currentSmoothHeading = targetSnapHeading;
                } else {
                    // Low-pass EMA Filter for Position Smoothing (alpha = 0.20)
                    currentSmoothLat += (targetSnapLat - currentSmoothLat) * 0.20;
                    currentSmoothLng += (targetSnapLng - currentSmoothLng) * 0.20;

                    // Shortest Arc Angular Difference Smoothing for Heading (beta = 0.15)
                    let angleDiff = ((targetSnapHeading - currentSmoothHeading + 540) % 360) - 180;
                    // Deadband hysteresis: ignore micro-wobbles under 1.8 degrees to prevent indoor rotation jitter
                    if (Math.abs(angleDiff) > 1.8) {
                        currentSmoothHeading = (currentSmoothHeading + angleDiff * 0.15 + 360) % 360;
                    }
                }

                currentHeading = currentSmoothHeading;

                const vehicleMarkerRotation = currentSmoothHeading;

                const vehicleIconHtml = `
                    <div class="vehicle-marker-wrapper">
                        <div class="vehicle-radar-cone" style="transform: rotate(${vehicleMarkerRotation}deg); transform-origin: 50% 100%;"></div>
                        <div class="vehicle-marker-core" style="transform: rotate(${vehicleMarkerRotation}deg);">
                            <svg class="vehicle-svg-arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2L4 21L12 17L20 21L12 2Z" fill="#ffffff" stroke="#0369a1" stroke-width="1.5" stroke-linejoin="round"/>
                            </svg>
                        </div>
                    </div>
                `;

                const vehicleIcon = L.divIcon({
                    className: 'custom-vehicle-marker',
                    html: vehicleIconHtml,
                    iconSize: [48, 48],
                    iconAnchor: [24, 24]
                });

                if (startMarker) {
                    startMarker.setLatLng([currentSmoothLat, currentSmoothLng]);
                    startMarker.setIcon(vehicleIcon);
                } else {
                    startMarker = L.marker([currentSmoothLat, currentSmoothLng], { icon: vehicleIcon }).addTo(map);
                }

                const carArrow = document.getElementById('car-heading-arrow');
                if (carArrow) carArrow.style.transform = `translate(-50%, -50%) rotate(${currentSmoothHeading}deg)`;

                if (isLiveNavActive && !isUserMapPanning && map) {
                    map.setView([currentSmoothLat, currentSmoothLng], 17.5, { animate: false });
                    applyMapRotation(currentSmoothHeading);
                }
            }

            vehicleAnimFrameId = requestAnimationFrame(animateFrame);
        }

        vehicleAnimFrameId = requestAnimationFrame(animateFrame);
    }

    function renderDynamicRemainingPath(carLat, carLng, carHeading) {
        if (!selectedRouteObj || !selectedRouteObj.analyzed || !selectedRouteObj.analyzed.segments || !activeRoutePolylineGroup) {
            return;
        }

        const coords = selectedRouteObj.analyzed.coordinates;
        const snap = ShadowRouter.snapPositionAndHeadingToRoad(carLat, carLng, carHeading, coords);
        const segIdx = Math.max(0, Math.min(selectedRouteObj.analyzed.segments.length - 1, snap.segmentIndex || 0));
        const segments = selectedRouteObj.analyzed.segments;

        activeRoutePolylineGroup.clearLayers();

        // 1. Current segment (from vehicle snapped position to end of this segment)
        if (segIdx < segments.length) {
            const curSeg = segments[segIdx];
            let curColor = '#0284c7';
            if (curSeg.glareRisk > 0.45) curColor = '#f59e0b';
            else if (curSeg.shadeScore > 0.5) curColor = '#7c3aed';

            L.polyline([[snap.lat, snap.lng], curSeg.p2], {
                color: curColor,
                weight: 8,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(activeRoutePolylineGroup);
        }

        // 2. All remaining forward segments to destination
        for (let i = segIdx + 1; i < segments.length; i++) {
            const seg = segments[i];
            let segColor = '#0284c7';
            if (seg.glareRisk > 0.45) segColor = '#f59e0b';
            else if (seg.shadeScore > 0.5) segColor = '#7c3aed';

            L.polyline([seg.p1, seg.p2], {
                color: segColor,
                weight: 8,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(activeRoutePolylineGroup);
        }

        // 3. Dynamic remaining distance and ETA calculation
        const remDistMeters = ShadowRouter.calculateRemainingRouteDistance(snap.lat, snap.lng, coords, segIdx);
        const totalDist = selectedRouteObj.distanceMeters || 1;
        const remSec = Math.max(30, Math.round((remDistMeters / totalDist) * selectedRouteObj.durationSec));
        const isKo = I18n.getLanguage().startsWith('ko');
        const durMin = Math.max(1, Math.round(remSec / 60));
        const distKm = (remDistMeters / 1000).toFixed(1);

        const sumTimeEl = document.getElementById('sum-time');
        const sumDistEl = document.getElementById('sum-dist');
        if (sumTimeEl) sumTimeEl.innerText = `${durMin}${isKo ? '분' : 'm'}`;
        if (sumDistEl) sumDistEl.innerText = `${distKm} km`;
    }

    function updateVehicleMarkerPosition(lat, lng, heading = 0) {
        let snapResult = { lat, lng, heading, isSnapped: false, segmentIndex: 0 };

        if (selectedRouteObj && selectedRouteObj.analyzed && selectedRouteObj.analyzed.coordinates) {
            snapResult = ShadowRouter.snapPositionAndHeadingToRoad(lat, lng, heading, selectedRouteObj.analyzed.coordinates);
        }

        targetSnapLat = snapResult.lat;
        targetSnapLng = snapResult.lng;
        targetSnapHeading = snapResult.heading;

        startVehicleMarkerAnimationLoop();

        if (isLiveNavActive && selectedRouteObj) {
            renderDynamicRemainingPath(snapResult.lat, snapResult.lng, snapResult.heading);
        }
    }

    function toggleCompassMode() {
        const btn = document.getElementById('btn-toggle-compass');
        const tag = document.getElementById('compass-mode-tag');
        const isKo = I18n.getLanguage().startsWith('ko');

        if (compassMode === 'heading-up') {
            compassMode = 'north-up';
            if (btn) btn.classList.remove('heading-up');
            if (tag) tag.innerText = isKo ? "북쪽고정" : "NORTH-UP";
            applyMapRotation(0);
            TTSVoice.speak(isKo ? "북쪽 고정 모드입니다." : "North-up mode activated.");
        } else {
            compassMode = 'heading-up';
            if (btn) btn.classList.add('heading-up');
            if (tag) tag.innerText = isKo ? "주행방향" : "HEADING-UP";
            applyMapRotation(currentHeading);
            TTSVoice.speak(isKo ? "주행 방향 모드입니다." : "Heading-up mode activated.");
        }
    }

    function applyMapRotation(heading) {
        const mapWrapper = document.getElementById('map-perspective-wrapper');
        const mapElement = document.getElementById('map');
        if (!mapElement || !mapWrapper) return;

        if (compassMode === 'heading-up' && heading !== undefined) {
            if (!mapWrapper.classList.contains('heading-up-active')) {
                mapWrapper.classList.add('heading-up-active');
                if (map) map.invalidateSize();
            }
            // Rotation deadband filter: Only update DOM transform if angular delta is >= 1.0 degrees
            if (lastAppliedMapRotation === null || Math.abs(((heading - lastAppliedMapRotation + 540) % 360) - 180) >= 1.0) {
                lastAppliedMapRotation = heading;
                mapElement.style.transform = `rotate(${-heading}deg)`;
                mapWrapper.style.setProperty('--map-counter-rotation', `${heading}deg`);
            }
        } else {
            if (mapWrapper.classList.contains('heading-up-active')) {
                mapWrapper.classList.remove('heading-up-active');
                if (map) map.invalidateSize();
            }
            mapElement.style.transform = 'none';
            mapWrapper.style.setProperty('--map-counter-rotation', '0deg');
            lastAppliedMapRotation = null;
        }
    }

    async function resolveAndStartNavigation() {
        const destInput = document.getElementById('destination-input');
        const typedText = destInput ? destInput.value.trim() : "";
        const isKo = I18n.getLanguage().startsWith('ko');

        if (!typedText) {
            alert(isKo ? "목적지 장소나 주소를 입력해 주세요." : "Please enter a destination place or address.");
            return;
        }

        if (!currentEnd || destinationName !== typedText) {
            const btn = document.getElementById('btn-confirm-destination');
            if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${isKo ? '스마트 위치 검색 중...' : 'Searching place...'}`;

            const results = await Geocoder.searchPlaces(typedText, currentStart);
            if (results && results.length > 0) {
                currentEnd = { lat: results[0].lat, lng: results[0].lng };
                destinationName = results[0].shortTitle || results[0].displayName;
                destInput.value = destinationName;
            } else {
                if (btn) btn.innerHTML = `<i class="fa-solid fa-route"></i> ${I18n.getText('confirmStartBtn')}`;
                alert(isKo ? `'${typedText}' 위치를 찾을 수 없습니다. 주소나 지역명을 다시 확인해 주세요.` : `Cannot find '${typedText}'. Please verify the address.`);
                return;
            }
        }

        startNavigationFlow();
    }

    function startNavigationFlow() {
        if (!currentEnd) return;

        saveDestinationHistory(destinationName, currentEnd);

        try {
            history.pushState({ navActive: true }, "SolarLess Navi", "#nav");
        } catch (e) {}

        document.getElementById('start-search-modal').classList.add('hidden');
        document.getElementById('bar-dest-text').innerText = destinationName || "Destination Set";

        updateRoute();
    }

    function openSearchModal() {
        renderFavorites();
        renderRecentDestinationHistory();
        document.getElementById('start-search-modal').classList.remove('hidden');
        document.getElementById('sidebar-panel').classList.remove('active');
    }

    function getDateFromMinutes(mins) {
        const d = new Date();
        d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        return d;
    }

    function formatTime(mins) {
        const hrs = Math.floor(mins / 60);
        const m = mins % 60;
        return `${hrs < 10 ? '0'+hrs : hrs}:${m < 10 ? '0'+m : m}`;
    }

    /* REAL-TIME DYNAMIC GPS SUNCALC ASTRONOMICAL SUNRISE/SUNSET & ELEVATION */
    function updateSunInfo() {
        let dateObj;
        const isKo = I18n.getLanguage().startsWith('ko');

        if (isRealTimeMode) {
            dateObj = new Date();
            selectedTimeMinutes = dateObj.getHours() * 60 + dateObj.getMinutes();
            document.getElementById('time-slider').value = selectedTimeMinutes;
            document.getElementById('time-display-text').innerText = `${isKo ? '실시간' : 'Live'} (${formatTime(selectedTimeMinutes)})`;
        } else {
            dateObj = getDateFromMinutes(selectedTimeMinutes);
            document.getElementById('time-display-text').innerText = `${isKo ? '설정 시각' : 'Set'} (${formatTime(selectedTimeMinutes)})`;
        }

        let centerLat = 0;
        let centerLng = 0;

        if (currentStart) {
            centerLat = currentStart.lat;
            centerLng = currentStart.lng;
        } else if (map) {
            const center = map.getCenter();
            centerLat = center.lat;
            centerLng = center.lng;
        } else {
            return;
        }

        try {
            const times = SunCalc.getTimes(dateObj, centerLat, centerLng);
            if (times.sunrise && times.solarNoon && times.sunset) {
                gpsSunTimes.sunriseMins = times.sunrise.getHours() * 60 + times.sunrise.getMinutes();
                gpsSunTimes.noonMins = times.solarNoon.getHours() * 60 + times.solarNoon.getMinutes();
                gpsSunTimes.sunsetMins = times.sunset.getHours() * 60 + times.sunset.getMinutes();

                const btnSunrise = document.getElementById('btn-sunrise-time');
                const btnNoon = document.getElementById('btn-noon-time');
                const btnSunset = document.getElementById('btn-sunset-time');

                const labelSunrise = I18n.getText('sunrise');
                const labelNoon = I18n.getText('solarNoon');
                const labelSunset = I18n.getText('sunset');

                if (btnSunrise) btnSunrise.innerHTML = `<i class="fa-solid fa-sun-plant-wilt"></i> <span>${labelSunrise}</span><br><strong>${formatTime(gpsSunTimes.sunriseMins)}</strong>`;
                if (btnNoon) btnNoon.innerHTML = `<i class="fa-solid fa-sun"></i> <span>${labelNoon}</span><br><strong>${formatTime(gpsSunTimes.noonMins)}</strong>`;
                if (btnSunset) btnSunset.innerHTML = `<i class="fa-solid fa-cloud-sun"></i> <span>${labelSunset}</span><br><strong>${formatTime(gpsSunTimes.sunsetMins)}</strong>`;
            }
        } catch (e) {
            console.warn("SunCalc getTimes calculation warning:", e);
        }

        const sunPos = SunCalc.getPosition(dateObj, centerLat, centerLng);

        const az = Math.round(sunPos.azimuth);
        let cardinal = "N";
        if (az >= 22.5 && az < 67.5) cardinal = "NE";
        else if (az >= 67.5 && az < 112.5) cardinal = "E";
        else if (az >= 112.5 && az < 157.5) cardinal = "SE";
        else if (az >= 157.5 && az < 202.5) cardinal = "S";
        else if (az >= 202.5 && az < 247.5) cardinal = "SW";
        else if (az >= 247.5 && az < 292.5) cardinal = "W";
        else if (az >= 292.5 && az < 337.5) cardinal = "NW";

        document.getElementById('sun-azimuth-val').innerText = `${az}° (${cardinal})`;
        document.getElementById('sun-elevation-val').innerText = `${sunPos.altitude.toFixed(1)}°`;

        const sunPointer = document.getElementById('sun-vector-pointer');
        if (sunPointer) sunPointer.style.transform = `rotate(${az}deg)`;

        checkAndUpdateMapTileTheme();
        return sunPos;
    }

    async function updateRoute(isMidDrive = false) {
        if (!currentEnd) return;

        const dateObj = isRealTimeMode ? new Date() : getDateFromMinutes(selectedTimeMinutes);
        const sunPos = updateSunInfo();

        try {
            routeData = await ShadowRouter.fetchAndAnalyzeRoutes(currentStart, currentEnd, dateObj, isTollFreeOnly);
        } catch (e) {
            if (e && e.code === "TRANS_OCEANIC") {
                const km = e.distanceKm ? e.distanceKm.toLocaleString() : "1,500+";
                const isKo = I18n.getLanguage().startsWith('ko');
                alert(isKo ? `⚠️ 자동차로 이동할 수 없는 대륙 간 / 해양 건너편 위치입니다 (거리: ${km} km).\n\n현재 계신 국가/지역 내의 목적지를 검색하거나 선택해 주세요.` : `⚠️ Unreachable overseas or trans-oceanic destination (Distance: ${km} km).\n\nPlease search or select a destination reachable by road in your region.`);
                openSearchModal();
                return;
            }
            routeData = OfflineMap.generateStandaloneRoute(currentStart, currentEnd, dateObj);
        }

        updateRouteOptionButtons(routeData);

        selectedRouteObj = routeData.routes[currentMode] || routeData.routes.glareFree;

        renderMapMarkersAndPolyline(selectedRouteObj, isMidDrive || isLiveNavActive);
        updateSummaryBox(selectedRouteObj);
        updateHUDWithRoute(selectedRouteObj, sunPos);

        if (isMidDrive || isLiveNavActive) {
            if (currentStart) {
                updateVehicleMarkerPosition(currentStart.lat, currentStart.lng, currentHeading);
                if (!isUserMapPanning && map) {
                    map.setView([currentStart.lat, currentStart.lng], 17.5, { animate: true });
                }
            }
        }
    }

    function updateRouteOptionButtons(routeData) {
        const isKo = I18n.getLanguage().startsWith('ko');
        const fst = routeData.routes.fastest;
        const glr = routeData.routes.glareFree;
        const shd = routeData.routes.shade;

        const fstMin = Math.max(1, Math.round(fst.durationSec / 60));
        const glrMin = Math.max(1, Math.round(glr.durationSec / 60));
        const shdMin = Math.max(1, Math.round(shd.durationSec / 60));

        const fstKm = (fst.distanceMeters / 1000).toFixed(1);
        const glrKm = (glr.distanceMeters / 1000).toFixed(1);
        const shdKm = (shd.distanceMeters / 1000).toFixed(1);

        const fstKmNum = parseFloat(fstKm);
        const glrKmNum = parseFloat(glrKm);
        const shdKmNum = parseFloat(shdKm);

        function formatRouteDetourText(routeMin, routeKmStr, fstMin, fstKmStr) {
            const diffMin = routeMin - fstMin;
            const diffKmVal = (parseFloat(routeKmStr) - parseFloat(fstKmStr));
            const diffKmStr = Math.abs(diffKmVal).toFixed(1);
            const hasDistDiff = Math.abs(diffKmVal) >= 0.05;

            if (diffMin > 0) {
                return `+${diffMin}${isKo ? '분 우회' : 'm detour'}`;
            } else if (diffMin < 0) {
                return `${diffMin}${isKo ? '분 단축' : 'm faster'}`;
            } else {
                if (hasDistDiff) {
                    const sign = diffKmVal > 0 ? `+${diffKmStr}km` : `-${diffKmStr}km`;
                    return isKo ? `시간 동일 (${sign})` : `Same time (${sign})`;
                } else {
                    return isKo ? '최단과 동일' : 'Same as fastest';
                }
            }
        }

        const fstGlarePct = fst.analyzed ? Math.round(fst.analyzed.avgGlareRisk * 100) : 0;
        const glrGlarePct = glr.analyzed ? Math.round(glr.analyzed.avgGlareRisk * 100) : 0;
        const shdGlarePct = shd.analyzed ? Math.round(shd.analyzed.avgGlareRisk * 100) : 0;

        const glrUvCut = glr.uvReductionPct || 0;
        const shdUvCut = shd.uvReductionPct || 0;

        // 1. Fastest Route (기준 탐색 경로: 역광위험도 n%, 자외선 기준치)
        document.getElementById('eta-fastest').innerText = `⏱️ ${fstMin}${isKo ? '분' : 'm'} (${fstKm}km)`;
        const fstDesc = document.getElementById('desc-fastest');
        if (fstDesc) {
            fstDesc.innerText = isKo
                ? `역광 위험도 ${fstGlarePct}% | 자외선 기준치`
                : `Glare Risk ${fstGlarePct}% | UV Baseline`;
        }
        const fstTraffic = document.getElementById('traffic-fastest');
        if (fstTraffic) {
            fstTraffic.classList.remove('hidden');
            if (routeData.trafficMultiplier > 1.3) {
                fstTraffic.innerText = isKo ? "서행/혼잡 🟡" : "Moderate 🟡";
                fstTraffic.className = "traffic-chip mod";
            } else {
                fstTraffic.innerText = isKo ? "교통원활 🟢" : "Smooth 🟢";
                fstTraffic.className = "traffic-chip smooth";
            }
        }

        // 2. Glare-Free Route (역광/눈부심 회피 경로: 우회정보 | 역광위험도 n% | 자외선 n% 감소)
        const glrDiffText = formatRouteDetourText(glrMin, glrKmNum, fstMin, fstKmNum);
        document.getElementById('eta-glare').innerText = `⏱️ ${glrMin}${isKo ? '분' : 'm'} (${glrKm}km)`;

        const glrDesc = document.getElementById('desc-glare');
        if (glrDesc) {
            if (glr.isNight) {
                glrDesc.innerText = `${glrDiffText} | ${isKo ? '역광 위험도 0% | 야간 (자외선 0% 🌙)' : 'Glare Risk 0% | Night (UV 0% 🌙)'}`;
            } else if (glrUvCut > 0) {
                glrDesc.innerText = `${glrDiffText} | ${isKo ? `역광 위험도 ${glrGlarePct}% | 자외선 ${glrUvCut}% 감소 🛡️` : `Glare Risk ${glrGlarePct}% | UV -${glrUvCut}% 🛡️`}`;
            } else {
                glrDesc.innerText = `${glrDiffText} | ${isKo ? `역광 위험도 ${glrGlarePct}% | 자외선 기준치 🛡️` : `Glare Risk ${glrGlarePct}% | UV Baseline 🛡️`}`;
            }
        }

        // 3. Shade Route (그늘·구조물 우선 경로: 우회정보 | 역광위험도 n% | 자외선 n% 감소)
        const shdDiffText = formatRouteDetourText(shdMin, shdKmNum, fstMin, fstKmNum);
        document.getElementById('eta-shade').innerText = `⏱️ ${shdMin}${isKo ? '분' : 'm'} (${shdKm}km)`;

        const shdDesc = document.getElementById('desc-shade');
        if (shdDesc) {
            if (shd.isNight) {
                shdDesc.innerText = `${shdDiffText} | ${isKo ? '역광 위험도 0% | 야간 (자외선 0% 🌙)' : 'Glare Risk 0% | Night (UV 0% 🌙)'}`;
            } else if (shdUvCut > 0) {
                shdDesc.innerText = `${shdDiffText} | ${isKo ? `역광 위험도 ${shdGlarePct}% | 자외선 ${shdUvCut}% 감소 ☂️` : `Glare Risk ${shdGlarePct}% | UV -${shdUvCut}% ☂️`}`;
            } else {
                shdDesc.innerText = `${shdDiffText} | ${isKo ? `역광 위험도 ${shdGlarePct}% | 자외선 기준치 ☂️` : `Glare Risk ${shdGlarePct}% | UV Baseline ☂️`}`;
            }
        }
    }

    function renderMapMarkersAndPolyline(selectedRouteObj, isLiveDrive = false) {
        if (!selectedRouteObj || !selectedRouteObj.analyzed || !selectedRouteObj.analyzed.coordinates) return;

        if (activeRoutePolylineGroup) {
            activeRoutePolylineGroup.clearLayers();
        } else {
            activeRoutePolylineGroup = L.featureGroup().addTo(map);
        }

        const endIcon = L.divIcon({
            className: 'custom-map-marker end',
            html: `<div style="background:#ff453a; color:#fff; font-weight:800; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px #ff453a; border:2px solid #fff; font-size:14px;"><i class="fa-solid fa-flag-checkered"></i></div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });

        if (endMarker) map.removeLayer(endMarker);
        endMarker = L.marker([currentEnd.lat, currentEnd.lng], { icon: endIcon }).addTo(map);

        updateVehicleMarkerPosition(currentStart.lat, currentStart.lng, currentHeading);

        if (!isLiveDrive && routeData && routeData.routes && routeData.routes.all) {
            routeData.routes.all.forEach(rt => {
                if (rt !== selectedRouteObj && rt.analyzed && rt.analyzed.coordinates) {
                    const inactiveCoords = rt.analyzed.coordinates.map(c => [c[1], c[0]]);
                    L.polyline(inactiveCoords, {
                        color: '#64748b',
                        weight: 5,
                        opacity: 0.5,
                        dashArray: '6, 8'
                    }).addTo(activeRoutePolylineGroup);
                }
            });
        }

        const segments = selectedRouteObj.analyzed.segments;
        if (segments) {
            segments.forEach(seg => {
                let segColor = '#0284c7';
                if (seg.glareRisk > 0.45) segColor = '#f59e0b';
                else if (seg.shadeScore > 0.5) segColor = '#7c3aed';

                L.polyline([seg.p1, seg.p2], {
                    color: segColor,
                    weight: 8,
                    opacity: 0.95,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(activeRoutePolylineGroup);
            });
        }

        // Camera auto-framing: only fit bounds when planning/previewing route, NOT when actively navigating
        if (!isLiveDrive && !isLiveNavActive) {
            const allCoords = selectedRouteObj.analyzed.coordinates.map(c => [c[1], c[0]]);
            map.fitBounds(L.polyline(allCoords).getBounds(), { padding: [40, 40] });
        }
    }

    /* CLEAR ALL MAP POLYLINES, DESTINATION MARKERS, & BANNER WHEN GUIDANCE ENDS */
    function clearRouteFromMap() {
        if (activeRoutePolylineGroup) {
            activeRoutePolylineGroup.clearLayers();
        }
        if (endMarker) {
            map.removeLayer(endMarker);
            endMarker = null;
        }

        currentEnd = null;
        routeData = null;
        selectedRouteObj = null;

        const isKo = I18n.getLanguage().startsWith('ko');
        const destChip = document.getElementById('bar-dest-text');
        if (destChip) destChip.innerText = isKo ? "목적지를 설정하세요" : "Set Destination";

        const turnBanner = document.getElementById('mobile-turn-banner');
        if (turnBanner) turnBanner.classList.remove('active', 'hazard');

        document.getElementById('sum-time').innerText = "--";
        document.getElementById('sum-dist').innerText = "-- km";
        document.getElementById('sum-glare').innerText = "--%";
        document.getElementById('sum-shade').innerText = "--%";
    }

    function updateSummaryBox(selectedRouteObj) {
        const isKo = I18n.getLanguage().startsWith('ko');
        const durMin = Math.round(selectedRouteObj.durationSec / 60);
        const distKm = (selectedRouteObj.distanceMeters / 1000).toFixed(1);
        const glarePct = selectedRouteObj.analyzed ? Math.round(selectedRouteObj.analyzed.avgGlareRisk * 100) : 0;
        const shadePct = selectedRouteObj.analyzed ? Math.round(selectedRouteObj.analyzed.avgShadeCoverage * 100) : 0;

        document.getElementById('sum-time').innerText = `${durMin}${isKo ? '분' : 'm'}`;
        document.getElementById('sum-dist').innerText = `${distKm} km`;
        document.getElementById('sum-glare').innerText = `${glarePct}%`;
        document.getElementById('sum-shade').innerText = `${shadePct}%`;
    }

    function updateHUDWithRoute(selectedRouteObj, sunPos) {
        const isKo = I18n.getLanguage().startsWith('ko');
        const glarePct = selectedRouteObj.analyzed ? Math.round(selectedRouteObj.analyzed.avgGlareRisk * 100) : 0;
        document.getElementById('glare-pct-val').innerText = `${glarePct}%`;
        document.getElementById('glare-meter-fill').style.width = `${glarePct}%`;

        const badge = document.getElementById('glare-risk-badge');
        const advice = document.getElementById('hazard-advice-text');

        if (glarePct > 55) {
            badge.innerText = 'CRITICAL GLARE';
            badge.className = 'status-badge';
            advice.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${isKo ? '서쪽/태양 정면 진입 구간 다수 포함! 햇빛 가리개 필수.' : 'Heavy sun glare ahead. Lower sun visor.'}`;
        } else if (glarePct > 25) {
            badge.innerText = 'MODERATE GLARE';
            badge.className = 'status-badge mod';
            advice.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${isKo ? '부분적 역광 구간 포함. 안전거리 확보.' : 'Partial sun glare segments. Maintain safe distance.'}`;
        } else {
            badge.innerText = 'SAFE / LOW GLARE';
            badge.className = 'status-badge low';
            advice.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${isKo ? '역광 위험도가 낮은 쾌적한 주행 경로입니다.' : 'Low glare risk. Comfortable driving route.'}`;
        }
    }

    function setupAutocomplete(inputId, dropdownId, onSelect) {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        let debounceTimer = null;

        input.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const val = e.target.value;

            if (inputId === 'destination-input') {
                const btn = document.getElementById('btn-confirm-destination');
                if (btn) btn.disabled = val.trim().length === 0;
            }

            if (val.length < 2) {
                dropdown.classList.remove('active');
                return;
            }

            debounceTimer = setTimeout(async () => {
                const results = await Geocoder.searchPlaces(val, currentStart);
                dropdown.innerHTML = '';
                if (!results || results.length === 0) {
                    dropdown.classList.remove('active');
                    return;
                }

                results.forEach(res => {
                    const item = document.createElement('div');
                    item.className = 'result-item';
                    const distTag = res.distKm !== null ? `<span class="dist-tag" style="color:#fbbf24; font-size:11px; font-weight:700;">📍 ${res.distKm < 1 ? Math.round(res.distKm * 1000) + 'm' : res.distKm.toFixed(1) + 'km'}</span>` : '';
                    item.innerHTML = `
                        <i class="fa-solid fa-location-dot" style="color:var(--accent-cyan)"></i>
                        <div style="flex:1; overflow:hidden;">
                            <div style="font-weight:700; color:#fff; display:flex; align-items:center; justify-content:space-between; gap:6px;">
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${res.shortTitle || res.displayName}</span>
                                ${distTag}
                            </div>
                            <div style="font-size:11px; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${res.displayName}</div>
                        </div>
                    `;
                    item.addEventListener('click', () => {
                        input.value = res.shortTitle || res.displayName;
                        dropdown.classList.remove('active');
                        onSelect({ lat: res.lat, lng: res.lng }, res.shortTitle || res.displayName);
                    });
                    dropdown.appendChild(item);
                });

                dropdown.classList.add('active');
            }, 250);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                dropdown.classList.remove('active');
                if (inputId === 'destination-input') {
                    resolveAndStartNavigation();
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });
    }

    setupAutocomplete('origin-input', 'origin-results', (coords, name) => {
        currentStart = coords;
        if (currentEnd) updateRoute();
    });

    setupAutocomplete('destination-input', 'destination-results', (coords, name) => {
        currentEnd = coords;
        destinationName = name;
        document.getElementById('btn-confirm-destination').disabled = false;
        startNavigationFlow();
    });

    document.getElementById('btn-confirm-destination').addEventListener('click', resolveAndStartNavigation);
    document.getElementById('btn-open-search-modal').addEventListener('click', openSearchModal);
    document.getElementById('btn-top-bar-change').addEventListener('click', openSearchModal);
    document.getElementById('btn-close-drawer').addEventListener('click', () => {
        document.getElementById('sidebar-panel').classList.remove('active');
    });

    const clearHistBtn = document.getElementById('btn-clear-history');
    if (clearHistBtn) {
        clearHistBtn.addEventListener('click', clearDestinationHistory);
    }

    document.getElementById('btn-toggle-compass').addEventListener('click', toggleCompassMode);

    document.getElementById('btn-toggle-voice').addEventListener('click', () => {
        const isMuted = TTSVoice.toggleMute();
        const icon = document.getElementById('voice-icon');
        const btn = document.getElementById('btn-toggle-voice');

        if (isMuted) {
            icon.className = "fa-solid fa-volume-xmark";
            btn.classList.add('muted');
            TTSVoice.speak(I18n.getLanguage().startsWith('ko') ? "음성 안내 꺼짐" : "Muted", true);
        } else {
            icon.className = "fa-solid fa-volume-high";
            btn.classList.remove('muted');
            TTSVoice.speak(I18n.getLanguage().startsWith('ko') ? "음성 안내 켜짐" : "Voice enabled", true);
        }
    });

    /* COUNTRY-SPECIFIC ROAD SIGN DISPLAY (US MUTCD RECTANGULAR vs KR RED CIRCLE & US STOP SIGN) */
    async function updateSpeedLimitDisplay(lat, lng) {
        const now = Date.now();
        if (now - lastSpeedLimitFetchTime < 6000) return; // 6-second throttle for API efficiency
        lastSpeedLimitFetchTime = now;

        const badgeKr = document.getElementById('speed-limit-badge-kr');
        const badgeUs = document.getElementById('speed-limit-badge-us');
        const stopBadgeUs = document.getElementById('us-stop-sign-badge');
        const valKr = document.getElementById('limit-val-kr');
        const valUs = document.getElementById('limit-val-us');
        const unitVal = document.getElementById('speed-unit-val');

        const roadData = await Geocoder.fetchCurrentRoadSpeedLimitAndRules(lat, lng);
        currentCountry = roadData.country;

        // Real-Time Road Tunnel Status Update & Automatic Theme Refresh
        if (isCurrentRoadTunnel !== !!roadData.isTunnel) {
            isCurrentRoadTunnel = !!roadData.isTunnel;
            checkAndUpdateMapTileTheme();
        }

        // Update Unit Display
        if (unitVal) {
            unitVal.innerText = roadData.unit || (currentCountry === 'US' ? 'mph' : 'km/h');
        }

        // US STOP Sign Badge Display Control
        if (stopBadgeUs) {
            if (currentCountry === 'US' && roadData.isStopSignAhead) {
                stopBadgeUs.classList.remove('hidden');
            } else {
                stopBadgeUs.classList.add('hidden');
            }
        }

        // Country-Specific Speed Limit Sign Styling
        if (roadData.speedLimit !== null && roadData.speedLimit > 0) {
            currentSpeedLimit = roadData.speedLimit;

            if (currentCountry === 'US') {
                // US MUTCD Rectangular White Sign
                if (valUs) valUs.innerText = roadData.speedLimit;
                if (badgeUs) badgeUs.classList.remove('hidden');
                if (badgeKr) badgeKr.classList.add('hidden');
            } else {
                // Korea / International Red Circle Sign
                if (valKr) valKr.innerText = roadData.speedLimit;
                if (badgeKr) badgeKr.classList.remove('hidden');
                if (badgeUs) badgeUs.classList.add('hidden');
            }
        } else {
            currentSpeedLimit = null; // No speed limit data for current road
            if (badgeKr) badgeKr.classList.add('hidden');
            if (badgeUs) badgeUs.classList.add('hidden');
        }

        // Highway, Toll Road & Toll Booth Real-Time Badges
        const badgeHwy = document.getElementById('road-badge-highway');
        const badgeToll = document.getElementById('road-badge-toll');
        const badgeBooth = document.getElementById('road-badge-tollbooth');

        if (badgeHwy) {
            if (roadData.isMotorway) badgeHwy.classList.remove('hidden');
            else badgeHwy.classList.add('hidden');
        }
        if (badgeToll) {
            if (roadData.isToll) badgeToll.classList.remove('hidden');
            else badgeToll.classList.add('hidden');
        }
        if (badgeBooth) {
            if (roadData.isTollBoothAhead) badgeBooth.classList.remove('hidden');
            else badgeBooth.classList.add('hidden');
        }

        // 3-Tier Highway / Toll Entry & Toll Booth Voice Guidance Announcement
        if (TTSVoice && typeof TTSVoice.announceRoadEnvironment === 'function') {
            TTSVoice.announceRoadEnvironment(roadData);
        }
    }

    function updateGpsSpeedometer(pos) {
        const speedEl = document.getElementById('speed-val');
        if (!speedEl) return;

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        let kmh = 0;
        if (pos.coords.speed !== null && !isNaN(pos.coords.speed) && pos.coords.speed > 0) {
            kmh = Math.round(pos.coords.speed * 3.6);
        } else if (lastGpsPosition && lastGpsTimestamp) {
            const timeDeltaSec = (pos.timestamp - lastGpsTimestamp) / 1000;
            if (timeDeltaSec > 0.5) {
                const distMeters = ShadowRouter.distanceToRoute(lat, lng, [[lastGpsPosition.lng, lastGpsPosition.lat]]);
                const calcSpeedMps = distMeters / timeDeltaSec;
                if (calcSpeedMps < 50) { // upper bound ~ 180km/h
                    kmh = Math.round(calcSpeedMps * 3.6);
                }
            }
        }

        // If US country, convert speedometer display to mph if unit is mph!
        const displaySpeed = currentCountry === 'US' ? Math.round(kmh * 0.621371) : kmh;
        speedEl.innerText = displaySpeed;

        // Fetch real-time country & speed limit for current road
        updateSpeedLimitDisplay(lat, lng);

        checkSpeedingHazard(displaySpeed);
    }

    function checkSpeedingHazard(currentSpeed) {
        const warningOverlay = document.getElementById('speeding-warning-overlay');
        const isKo = I18n.getLanguage().startsWith('ko');
        const now = Date.now();
        const unitText = currentCountry === 'US' ? 'mph' : (isKo ? '킬로미터' : 'km/h');

        // Only evaluate speeding if speed limit data exists for current road!
        if (currentSpeedLimit !== null && currentSpeed > currentSpeedLimit) {
            if (!isSpeedingWarningActive) {
                isSpeedingWarningActive = true;
                if (warningOverlay) warningOverlay.classList.remove('hidden');
                lastSpeedingAnnounceTime = now;
                TTSVoice.speak(isKo ? `과속 위험! 제한속도 ${currentSpeedLimit}${unitText}를 초과했습니다. 속도를 줄이세요.` : `Speed warning! Speed limit is ${currentSpeedLimit} ${unitText}. Please reduce speed.`, true, 'speeding');
            } else if (now - lastSpeedingAnnounceTime > 8000) {
                // Repeat warning chime every 8 seconds while speeding
                lastSpeedingAnnounceTime = now;
                TTSVoice.speak(isKo ? `속도 경고! 제한속도 ${currentSpeedLimit}${unitText} 감속하세요.` : `Speed warning! Please reduce speed below ${currentSpeedLimit} ${unitText}.`, true, 'speeding');
            }
        } else {
            if (isSpeedingWarningActive) {
                isSpeedingWarningActive = false;
                if (warningOverlay) warningOverlay.classList.add('hidden');
            }
        }
    }

    function handleDestinationArrival(navStartTime, navStartDistanceMeters) {
        if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
        isLiveNavActive = false;

        const isKo = I18n.getLanguage().startsWith('ko');
        TTSVoice.speak(isKo ? "목적지 부근에 도착했습니다. 안내를 종료합니다." : "You have arrived at your destination. Navigation guidance completed.", true);

        const durTotalMin = Math.max(1, Math.round((Date.now() - (navStartTime || Date.now())) / 60000));
        const distTotalKm = ((navStartDistanceMeters || 0) / 1000).toFixed(1);

        const destNameEl = document.getElementById('arrival-dest-name');
        if (destNameEl) destNameEl.innerText = destinationName || (isKo ? "목적지" : "Destination");

        const timeValEl = document.getElementById('arrival-val-time');
        if (timeValEl) timeValEl.innerText = `${durTotalMin} ${isKo ? '분' : 'min'}`;

        const distValEl = document.getElementById('arrival-val-dist');
        if (distValEl) distValEl.innerText = `${distTotalKm} km`;

        const modeValEl = document.getElementById('arrival-val-mode');
        if (modeValEl) {
            if (currentMode === 'glareFree') modeValEl.innerText = isKo ? "역광 회피 (눈부심 차단)" : "Glare-Free";
            else if (currentMode === 'shade') modeValEl.innerText = isKo ? "그늘·구조물 우선" : "Shade Priority";
            else modeValEl.innerText = isKo ? "최단 시간" : "Fastest";
        }

        const arrivalModal = document.getElementById('arrival-modal');
        if (arrivalModal) arrivalModal.classList.remove('hidden');

        const liveNavBtn = document.getElementById('live-gps-nav-btn');
        const directMapNavBtn = document.getElementById('btn-map-start-nav');
        if (liveNavBtn) {
            liveNavBtn.innerHTML = `<i class="fa-solid fa-location-arrow"></i> ${I18n.getText('liveNavStart')}`;
            liveNavBtn.classList.remove('active', 'reroute-mode');
        }
        if (directMapNavBtn) {
            directMapNavBtn.innerHTML = `<i class="fa-solid fa-play"></i> ${I18n.getText('mapStartNav')}`;
            directMapNavBtn.classList.remove('active', 'reroute-mode');
        }

        disableKeepAwake();
        applyMapRotation(compassMode === 'heading-up' ? currentHeading : 0);
        clearRouteFromMap();
        recenterMapToVehicle();
    }

    function toggleLiveGpsNavigation() {
        const btn = document.getElementById('live-gps-nav-btn');
        const directMapBtn = document.getElementById('btn-map-start-nav');
        const isKo = I18n.getLanguage().startsWith('ko');

        if (isLiveNavActive) {
            if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
            isLiveNavActive = false;
            recenterMapToVehicle();

            // Completely clear route lines, destination markers, and turn banner from map
            clearRouteFromMap();

            if (btn) {
                btn.innerHTML = `<i class="fa-solid fa-location-arrow"></i> ${I18n.getText('liveNavStart')}`;
                btn.classList.remove('active', 'reroute-mode');
            }
            if (directMapBtn) {
                directMapBtn.innerHTML = `<i class="fa-solid fa-play"></i> ${I18n.getText('mapStartNav')}`;
                directMapBtn.classList.remove('active', 'reroute-mode');
            }
            disableKeepAwake();
            applyMapRotation(compassMode === 'heading-up' ? currentHeading : 0);
            TTSVoice.speak(isKo ? "안내를 종료합니다." : "Ending navigation guidance.");
            return;
        }

        if (!currentEnd) {
            alert(isKo ? "목적지를 먼저 선택해 주세요." : "Please select a destination first.");
            openSearchModal();
            return;
        }

        if (!navigator.geolocation) {
            alert("Geolocation is not supported on this device.");
            return;
        }

        isLiveNavActive = true;
        recenterMapToVehicle();

        const navStartTime = Date.now();
        const navStartDistanceMeters = selectedRouteObj ? (selectedRouteObj.distanceMeters || 0) : 0;
        let isArrived = false;
        let consecutiveOffRouteCount = 0;

        if (btn) {
            btn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('liveNavStop')}`;
            btn.classList.add('active');
            btn.classList.remove('reroute-mode');
        }
        if (directMapBtn) {
            directMapBtn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('mapStopNav')}`;
            directMapBtn.classList.add('active');
            directMapBtn.classList.remove('reroute-mode');
        }

        const banner = document.getElementById('mobile-turn-banner');
        if (banner) banner.classList.add('active');

        enableKeepAwake();

        document.getElementById('sidebar-panel').classList.remove('active');

        // Dynamically announce exact selected route mode ("최단 시간 경로", "눈부심 방지 역광 회피 경로", "그늘 우선 경로")
        TTSVoice.speak(getRouteAnnouncementText(currentMode, false));

        gpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (isArrived) return;

                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const rawSpeedKmh = (pos.coords.speed !== null && !isNaN(pos.coords.speed) && pos.coords.speed > 0) ? (pos.coords.speed * 3.6) : 0;
                const hasHwHeading = (pos.coords.heading !== null && !isNaN(pos.coords.heading) && pos.coords.heading >= 0);

                // CRITICAL FOR DYNAMIC ROUTING: Keep currentStart synced to vehicle's actual coordinates!
                currentStart = { lat, lng };

                setGpsStatusIndicator(false, true);
                updateGpsSpeedometer(pos);

                let heading = currentHeading;

                if (!lastStableMovingGps) {
                    lastStableMovingGps = { lat, lng };
                    if (hasHwHeading) {
                        heading = pos.coords.heading;
                        stableGpsHeading = heading;
                    }
                } else {
                    const distMoved = ShadowRouter.calculateDistanceMeters(lastStableMovingGps.lat, lastStableMovingGps.lng, lat, lng);
                    
                    // INDOOR & STATIONARY DRIFT DEADBAND FILTER:
                    // If moving speed < 3.5 km/h AND displacement from last confirmed point < 4.5m,
                    // do NOT compute noisy bearing from jitter; preserve the solid stable heading!
                    if (rawSpeedKmh < 3.5 && distMoved < 4.5) {
                        heading = stableGpsHeading || currentHeading;
                    } else {
                        // Vehicle is moving meaningfully!
                        if (hasHwHeading && rawSpeedKmh > 2.0) {
                            heading = pos.coords.heading;
                        } else if (distMoved >= 3.0) {
                            heading = ShadowRouter.calculateBearing(lastStableMovingGps.lat, lastStableMovingGps.lng, lat, lng);
                        }
                        stableGpsHeading = heading;
                        lastStableMovingGps = { lat, lng };
                    }
                }

                lastGpsPosition = { lat, lng };
                lastGpsTimestamp = pos.timestamp;

                // 1. Destination Arrival Multi-Tier Proximity Check
                if (isLiveNavActive && currentEnd && !isArrived) {
                    const distToDest = ShadowRouter.calculateDistanceMeters(lat, lng, currentEnd.lat, currentEnd.lng);
                    let isNearEndSegment = false;
                    if (selectedRouteObj && selectedRouteObj.analyzed && selectedRouteObj.analyzed.coordinates) {
                        const coords = selectedRouteObj.analyzed.coordinates;
                        const snap = ShadowRouter.snapPositionAndHeadingToRoad(lat, lng, heading, coords);
                        if (snap.segmentIndex >= Math.max(0, coords.length - 3)) {
                            isNearEndSegment = true;
                        }
                    }

                    if (distToDest <= 55 || (isNearEndSegment && distToDest <= 80 && rawSpeedKmh < 30)) {
                        isArrived = true;
                        handleDestinationArrival(navStartTime, navStartDistanceMeters);
                        return;
                    }
                }

                // 2. Off-Route Detection & Auto Recalculation from Vehicle's Current Position
                if (selectedRouteObj && selectedRouteObj.analyzed && selectedRouteObj.analyzed.coordinates && !isArrived) {
                    const offRouteDist = ShadowRouter.distanceToRoute(lat, lng, selectedRouteObj.analyzed.coordinates);
                    const now = Date.now();

                    if (offRouteDist > 45) {
                        consecutiveOffRouteCount++;
                    } else {
                        consecutiveOffRouteCount = 0;
                    }

                    if ((consecutiveOffRouteCount >= 2 || offRouteDist > 65) && (now - lastRerouteTime) > 8000) {
                        lastRerouteTime = now;
                        consecutiveOffRouteCount = 0;
                        TTSVoice.speak(isKo ? "경로를 이탈했습니다. 현재 위치에서 새로 탐색합니다." : "Off route. Recalculating from current position.", true);
                        updateRoute(true);
                        return;
                    }
                }

                updateVehicleMarkerPosition(lat, lng, heading);

                // Only center map on vehicle if user is NOT panning manually!
                if (!isUserMapPanning && !isArrived) {
                    map.setView([lat, lng], 17.5, { animate: true });
                    applyMapRotation(currentHeading);
                }

                const sunPos = SunCalc.getPosition(new Date(), lat, lng);
                const glareRisk = ShadowRouter.calculateSegmentGlare(currentHeading, sunPos);

                updateTurnBannerText(200, currentHeading, glareRisk);

                if (glareRisk > 0.45) {
                    TTSVoice.announceProactiveGlareWarning(currentHeading, glareRisk);
                }

                TTSVoice.announceNavHazard(200, currentHeading, glareRisk);
            },
            (err) => { setGpsStatusIndicator(false, false); },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    }

    document.getElementById('btn-use-gps').addEventListener('click', () => requestUserGpsLocation(false));
    document.getElementById('btn-recenter-gps').addEventListener('click', recenterMapToVehicle);

    const btnCloseArrival = document.getElementById('btn-close-arrival-modal');
    if (btnCloseArrival) {
        btnCloseArrival.addEventListener('click', () => {
            const arrivalModal = document.getElementById('arrival-modal');
            if (arrivalModal) arrivalModal.classList.add('hidden');
        });
    }

    /* Direct One-Tap Map Start Button Listener */
    const directMapStartBtn = document.getElementById('btn-map-start-nav');
    if (directMapStartBtn) {
        directMapStartBtn.addEventListener('click', () => {
            if (isLiveNavActive && directMapStartBtn.classList.contains('reroute-mode')) {
                // Reroute active guidance to newly selected route
                updateRoute();
                directMapStartBtn.classList.remove('reroute-mode');
                directMapStartBtn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('mapStopNav')}`;

                const liveBtn = document.getElementById('live-gps-nav-btn');
                if (liveBtn) {
                    liveBtn.classList.remove('reroute-mode');
                    liveBtn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('liveNavStop')}`;
                }

                document.getElementById('sidebar-panel').classList.remove('active');
                TTSVoice.speak(getRouteAnnouncementText(currentMode, true));
            } else {
                toggleLiveGpsNavigation();
            }
        });
    }

    const timeSlider = document.getElementById('time-slider');
    timeSlider.addEventListener('input', (e) => {
        isRealTimeMode = false;
        selectedTimeMinutes = parseInt(e.target.value, 10);
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        if (currentEnd) updateRoute();
    });

    document.getElementById('btn-now-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-now-time').classList.add('active');
        isRealTimeMode = true;
        if (currentEnd) updateRoute();
    });

    document.getElementById('btn-sunrise-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-sunrise-time').classList.add('active');
        isRealTimeMode = false;
        selectedTimeMinutes = gpsSunTimes.sunriseMins;
        timeSlider.value = selectedTimeMinutes;
        if (currentEnd) updateRoute();
    });

    document.getElementById('btn-noon-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-noon-time').classList.add('active');
        isRealTimeMode = false;
        selectedTimeMinutes = gpsSunTimes.noonMins;
        timeSlider.value = selectedTimeMinutes;
        if (currentEnd) updateRoute();
    });

    document.getElementById('btn-sunset-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-sunset-time').classList.add('active');
        isRealTimeMode = false;
        selectedTimeMinutes = gpsSunTimes.sunsetMins;
        timeSlider.value = selectedTimeMinutes;
        if (currentEnd) updateRoute();
    });

    /* ROUTE MODE SELECTOR & MID-ROUTE REROUTING LOGIC WITH CANCEL HIGHLIGHT REVERT */
    function saveRouteModePreference(mode) {
        if (!['glareFree', 'fastest', 'shade'].includes(mode)) return;
        try {
            localStorage.setItem(SAVED_ROUTE_MODE_KEY, mode);
        } catch (e) {}
    }

    function updateModeButtonsHighlight() {
        document.querySelectorAll('.mode-btn').forEach(b => {
            if (b.getAttribute('data-mode') === currentMode) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
    }

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetMode = btn.getAttribute('data-mode');
            if (currentMode === targetMode) return;

            if (isLiveNavActive) {
                // Ask Confirmation Prompt for Mid-Route Rerouting BEFORE changing highlight or mode!
                const confirmReroute = confirm(I18n.getText('rerouteConfirm'));

                if (confirmReroute) {
                    // User confirmed OK: update mode, persist preference, and highlight to targetMode!
                    currentMode = targetMode;
                    saveRouteModePreference(currentMode);
                    updateModeButtonsHighlight();
                    updateRoute();
                    document.getElementById('sidebar-panel').classList.remove('active');
                    TTSVoice.speak(getRouteAnnouncementText(currentMode, true));
                } else {
                    // User pressed CANCEL: REVERT highlight back to currently active guidance mode!
                    updateModeButtonsHighlight();
                }
            } else {
                currentMode = targetMode;
                saveRouteModePreference(currentMode);
                updateModeButtonsHighlight();
                if (currentEnd) updateRoute();
            }
        });
    });

    document.getElementById('live-gps-nav-btn').addEventListener('click', () => {
        const liveBtn = document.getElementById('live-gps-nav-btn');
        if (isLiveNavActive && liveBtn && liveBtn.classList.contains('reroute-mode')) {
            // Reroute active guidance to newly selected route
            updateRoute();
            liveBtn.classList.remove('reroute-mode');
            liveBtn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('liveNavStop')}`;

            const directMapBtn = document.getElementById('btn-map-start-nav');
            if (directMapBtn) {
                directMapBtn.classList.remove('reroute-mode');
                directMapBtn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('mapStopNav')}`;
            }

            document.getElementById('sidebar-panel').classList.remove('active');
            TTSVoice.speak(getRouteAnnouncementText(currentMode, true));
        } else {
            toggleLiveGpsNavigation();
        }
    });

    /* GITHUB AUTOMATIC LATEST VERSION UPDATE CHECKER (v1.0 vs GitHub Release) */
    const CURRENT_APP_VERSION = "1.0";
    let latestDetectedVersionTag = "";
    let latestDetectedReleaseUrl = "";

    async function checkGitHubLatestVersion() {
        try {
            const repoUrl = "https://api.github.com/repos/HyeokjaeKwon26/Solarless-Navi/releases/latest";
            const res = await fetch(repoUrl, { cache: 'no-store' });
            if (!res.ok) return;

            const data = await res.json();
            if (!data || !data.tag_name) return;

            latestDetectedVersionTag = data.tag_name;
            latestDetectedReleaseUrl = data.html_url || "https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/latest";

            const latestTagNumStr = data.tag_name.replace(/^v/i, '').trim();
            const currentVerNum = parseFloat(CURRENT_APP_VERSION);
            const latestVerNum = parseFloat(latestTagNumStr);

            if (!isNaN(latestVerNum) && latestVerNum > currentVerNum) {
                showUpdateModal(data.tag_name, latestDetectedReleaseUrl);
            }
        } catch (err) {
            // Silently ignore if offline or repo release not found yet
        }
    }

    function showUpdateModal(latestTagName, releaseHtmlUrl) {
        const modal = document.getElementById('update-modal');
        const titleEl = document.getElementById('update-modal-title');
        const bodyEl = document.getElementById('update-info-msg');
        const btnDlText = document.getElementById('update-download-btn-text');
        const btnDl = document.getElementById('btn-download-update');
        const btnLaterText = document.getElementById('update-later-btn-text');

        if (titleEl) titleEl.innerText = I18n.getText('updateTitle');
        if (bodyEl) {
            const rawMsg = I18n.getText('updateMsg');
            bodyEl.innerText = rawMsg.replace('{VER}', latestTagName || "v1.1");
        }
        if (btnDlText) btnDlText.innerText = I18n.getText('updateDownloadBtn');
        if (btnLaterText) btnLaterText.innerText = I18n.getText('updateLaterBtn');
        if (btnDl && releaseHtmlUrl) btnDl.href = releaseHtmlUrl;

        if (modal) modal.classList.remove('hidden');
    }

    initMap();
});
