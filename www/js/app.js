/**
 * SOLARIS NAV - Main Application Controller
 * Pure 2D High-Performance Navigation System,
 * Dynamic Specific Route Voice Announcements ("최단 시간 경로로 안내를 시작합니다", "눈부심 방지 역광 회피 경로로 안내를 시작합니다", "그늘 우선 경로로 안내를 시작합니다"),
 * GPS Solar Sunrise/Sunset & Elevation Dark Mode Synchronization,
 * Toll-Free Route Avoidance Option, High-Res Satellite Imagery Layer.
 */

document.addEventListener('DOMContentLoaded', () => {

    const DEFAULT_FAVORITES = [
        { id: "home", name: "Home", coords: null, icon: "fa-house" },
        { id: "work", name: "Work", coords: null, icon: "fa-briefcase" },
        { id: "mart", name: "Supermarket", coords: null, icon: "fa-cart-shopping" }
    ];

    let map = null;
    let lightTileLayer = null;
    let darkTileLayer = null;
    let satelliteTileLayer = null;
    let currentTileLayer = null;

    let currentStart = null;
    let currentHeading = 0;
    let gpsPermissionState = 'unknown'; // prompt | coarse-granted | fine-granted | denied | denied-permanently
    let gpsFixState = 'idle'; // idle | pending | ready | error | unavailable
    let gpsFixPromise = null;
    let gpsLastFixSource = 'none';
    let gpsLastFixAt = 0;
    let gpsLastError = null;
    let gpsAccuracyCircle = null;
    let navigationStartPending = false;
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

    let compassMode = 'north-up'; // Planning starts north-up; valid movement heading enables heading-up at navigation start.
    let compassModeUserOverride = false;
    const PREVIEW_MAX_ZOOM = 16;
    const NAVIGATION_ZOOM = 17.5;
    let isAutoDarkModeEnabled = true;
    let isTollFreeOnly = false;
    let isSatelliteViewActive = false;
    let isBatterySaverActive = false;

    let routeData = null;
    let selectedRouteObj = null;
    let activeRoutePolylineGroup = null;
    let dynamicRemainingPolylineGroup = null;
    let dynamicRemainingLayers = new Map();
    let dynamicRemainingRouteId = null;
    let dynamicRemainingSegmentIndex = null;
    // Route progress is monotonic during one guidance session.  GPS can
    // briefly snap to a previously passed vertex (especially on parallel
    // roads/loops); retaining the last accepted progress prevents the
    // already-travelled purple path from being painted again.
    let navigationRouteProgress = {
        routeId: null,
        value: 0,
        segmentIndex: 0,
        t: 0,
        snap: null
    };
    let startMarker = null;
    let endMarker = null;

    let isLiveNavActive = false;
    let isPipMode = false;
    let gpsWatchId = null;
    let lastGpsPosition = null;
    let lastGpsTimestamp = null;
    let lastRerouteTime = 0;
    let navigationSessionRouteId = null;
    let navigationSessionRouteGeometry = null;
    // Set when a scene-refined glare/shade route has replaced the initial
    // heuristic route during an active navigation session.  This prevents a
    // repeated progress callback from announcing the same switch twice.
    let lastPrecisionSwitchRouteId = null;
    let precisionReroutePending = false;
    let precisionRerouteCooldownUntil = 0;
    const PRECISION_REROUTE_COOLDOWN_MS = 60000;
    let navigationSessionStartedAt = 0;
    let navigationSessionStartDistanceMeters = 0;
    let navigationSessionArrived = false;
    let navigationConsecutiveOffRouteCount = 0;
    let lastProcessedNavigationTimestamp = 0;
    let lastProcessedNavigationPosition = null;
    let lastProcessedNavigationAccuracy = Infinity;
    let lastGpsUncertainNoticeAt = 0;
    const NAVIGATION_LOCATION_DEDUPE_WINDOW_MS = 1500;
    let routeAbortController = null;
    let sceneRefinementAbortController = null;
    let pendingRouteRequestKey = null;
    // A usable OSRM route can be exposed before optional scene refinement
    // completes. Keep the full request identity separately so a later GPS fix
    // does not mistake "road route ready" for "all background work finished"
    // and repeatedly abort a healthy long-route refinement.
    let activeRouteRequestKey = null;
    let routeRefinementPending = false;
    let verifiedRouteRequestKey = null;
    let routeCandidateCacheKey = null;
    let routeAnalysisGeneration = 0;
    let scheduleTimeRouteUpdate = null;
    let lastTimeAnalysisCommitAt = 0;
    let wakeLockSentinel = null;
    let apiNoticeTimer = null;
    let solarRefreshTimer = null;
    let lastSolarStaleNotice = 0;

    function getRouteGeometryIdentity(route) {
        const coords = route && route.analyzed && Array.isArray(route.analyzed.coordinates)
            ? route.analyzed.coordinates : [];
        if (!coords.length) return route && route.id ? String(route.id) : null;
        const first = coords[0] || [];
        const last = coords[coords.length - 1] || [];
        return `${route && route.id ? route.id : 'route'}|${coords.length}|${first[0]},${first[1]}|${last[0]},${last[1]}`;
    }

    function resetNavigationRouteProgress(route = null) {
        navigationRouteProgress = {
            routeId: getRouteGeometryIdentity(route), value: 0,
            segmentIndex: 0, t: 0, snap: null
        };
    }

    function snapNavigationPosition(lat, lng, heading, route) {
        const coords = route && route.analyzed && Array.isArray(route.analyzed.coordinates)
            ? route.analyzed.coordinates : null;
        if (!coords || coords.length < 2) return { lat, lng, heading, isSnapped: false, segmentIndex: 0, t: 0, distMeters: 0 };
        const identity = getRouteGeometryIdentity(route);
        if (navigationRouteProgress.routeId !== identity) resetNavigationRouteProgress(route);
        const previous = navigationRouteProgress;
        const candidate = ShadowRouter.snapPositionAndHeadingToRoad(lat, lng, heading, coords, {
            previousSegmentIndex: previous.snap ? previous.segmentIndex : null,
            maxBacktrackSegments: 0
        });
        if (!candidate.isSnapped) return candidate;
        const candidateValue = Number(candidate.segmentIndex || 0) + Number(candidate.t || 0);
        // Do not let a noisy fix move the active route backwards. Keep the
        // last accepted snapped point until the vehicle reaches it again;
        // off-route detection still uses the raw GPS point and can trigger a
        // forward reroute when necessary.
        if (previous.snap && candidateValue + 0.15 < previous.value) {
            return { ...previous.snap, progressClamped: true };
        }
        navigationRouteProgress = {
            routeId: identity,
            value: candidateValue,
            segmentIndex: Number(candidate.segmentIndex || 0),
            t: Number(candidate.t || 0),
            snap: candidate
        };
        return candidate;
    }

    function precisionRouteStartsAtVehicle(route) {
        if (!isLiveNavActive) return true;
        if (!route || !currentStart || !route.analyzed || !Array.isArray(route.analyzed.coordinates)) return false;
        const coords = route.analyzed.coordinates;
        if (coords.length < 2) return false;
        // A precision candidate was calculated from the trip origin. Once
        // the vehicle has moved, swapping to that old geometry can send the
        // driver backwards. Only adopt it when its corridor still starts at
        // the current vehicle position; otherwise a later explicit reroute
        // must calculate a fresh forward route first.
        const distance = ShadowRouter.distanceToRoute(currentStart.lat, currentStart.lng, coords);
        if (!Number.isFinite(distance) || distance > 120) return false;
        const snap = ShadowRouter.snapPositionAndHeadingToRoad(currentStart.lat, currentStart.lng, currentHeading, coords);
        const segmentIndex = Math.max(0, Math.min(coords.length - 2, Number(snap && snap.segmentIndex) || 0));
        const localBearing = ShadowRouter.calculateBearing(
            coords[segmentIndex][1], coords[segmentIndex][0],
            coords[segmentIndex + 1][1], coords[segmentIndex + 1][0]
        );
        let headingDiff = Math.abs(Number(currentHeading) - localBearing);
        if (headingDiff > 180) headingDiff = 360 - headingDiff;
        return !Number.isFinite(Number(currentHeading)) || headingDiff <= 120;
    }

    function setSidebarOpen(open) {
        const sidebar = document.getElementById('sidebar-panel');
        const mapWrapper = document.getElementById('map-perspective-wrapper');
        const toggle = document.getElementById('mobile-toggle-panel');
        const nextOpen = !!open;
        if (sidebar) {
            sidebar.classList.toggle('active', nextOpen);
            if (!nextOpen) sidebar.style.transform = '';
        }
        if (mapWrapper) mapWrapper.classList.toggle('bottom-sheet-open', nextOpen);
        if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        if (nextOpen) {
            clearTimeout(recenterWaitTimer);
            clearInterval(recenterCountdownInterval);
            hideRecenterToast();
        } else if (isUserMapPanning && isLiveNavActive) {
            resetRecenterInactivityTimer();
        }
    }

    /* Free Map Panning & 8-Second Auto Recenter Toast Variables */
    let isUserMapPanning = false;
    let recenterWaitTimer = null;
    let recenterCountdownInterval = null;
    let countdownSecLeft = 3;
    let routeSummaryCycleTimer = null;
    let routeSummaryCycleIndex = 0;
    const ROUTE_SUMMARY_CYCLE_MS = 6000;

    let currentCountry = 'KR';
    let currentCountryCode = null;
    let currentSpeedUnit = 'km/h';
    let currentSpeedLimit = null; // null if no road speed limit data exists
    let lastSpeedLimitFetchTime = 0;
    let lastRoadDataErrorNotice = 0;
    let speedLimitRequestGeneration = 0;
    let speedLimitAbortController = null;
    let speedLimitRequestStartedAt = 0;
    let lastSpeedLimitQueryPosition = null;
    let lastSpeedLimitQuerySegment = null;
    let lastSpeedLimitQueryHeading = null;
    let lastSpeedLimitQueryRouteKey = null;
    const SPEED_LIMIT_MIN_REFRESH_MS = 6000;
    const SPEED_LIMIT_MAX_REFRESH_MS = 30000;
    const SPEED_LIMIT_MOVE_REFRESH_METERS = 65;
    const SPEED_LIMIT_HEADING_REFRESH_DEGREES = 25;
    let isSpeedingWarningActive = false;
    let lastSpeedingAnnounceTime = 0;
    let isAmbientLightDark = false;
    let isCurrentRoadTunnel = false;

    let gpsSunTimes = {
        sunriseMins: 360,
        noonMins: 750,
        sunsetMins: 1180
    };

    function setNavigationButtonsEnabled(isEnabled) {
        ['live-gps-nav-btn', 'btn-map-start-nav'].forEach((id) => {
            const button = document.getElementById(id);
            if (!button) return;
            const shouldDisable = !isEnabled && !isLiveNavActive;
            button.disabled = shouldDisable;
            button.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');
        });
    }

    function showRouteFailureMessage(error, keptPreviousRoute = false) {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const messageKey = isOffline ? 'offlineRouteUnavailable' : (error && error.messageKey);
        const base = messageKey
            ? I18n.getText(messageKey)
            : I18n.getText('routeNetworkError');
        const suffix = keptPreviousRoute ? `\n\n${I18n.getText('existingRouteKept')}` : '';
        showApiNotice(`${base}${suffix}`);
    }

    function showApiNotice(message) {
        if (!message) return;
        let notice = document.getElementById('api-status-banner');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'api-status-banner';
            notice.className = 'api-status-banner';
            notice.setAttribute('role', 'status');
            notice.setAttribute('aria-live', 'polite');
            const overlayStack = document.getElementById('map-bottom-overlay-stack');
            (overlayStack || document.body).appendChild(notice);
        }
        notice.textContent = String(message);
        notice.classList.add('active');
        clearTimeout(apiNoticeTimer);
        apiNoticeTimer = setTimeout(() => notice.classList.remove('active'), 5500);
    }

    function validateMapOverlayLayout() {
        const ids = [
            'map-attribution', 'route-summary-box', 'api-status-banner',
            'speedometer-bottom-left', 'map-controls-group', 'recenter-toast-banner'
        ];
        const rects = {};
        ids.forEach(id => {
            const element = document.getElementById(id);
            if (!element || element.classList.contains('hidden')) return;
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) rects[id] = rect;
        });
        const overlaps = window.RouteState && typeof window.RouteState.findRectIntersections === 'function'
            ? window.RouteState.findRectIntersections(rects, 1)
            : [];
        if (overlaps.length && window.console && typeof console.warn === 'function') {
            console.warn('Map overlay intersection detected:', overlaps);
        }
        return { rects, overlaps };
    }

    // The map bottom controls share one measured clearance area. This avoids
    // device-specific bottom magic numbers and keeps attribution clickable.
    function setupMapOverlayLayout() {
        const wrapper = document.getElementById('map-perspective-wrapper');
        const stack = document.getElementById('map-bottom-overlay-stack');
        if (!wrapper || !stack) return;
        const summary = document.getElementById('route-summary-box');
        if (summary && summary.parentElement !== stack) stack.appendChild(summary);
        const update = () => {
            const height = Math.ceil(stack.getBoundingClientRect().height || 0);
            wrapper.style.setProperty('--map-bottom-overlay-height', `${height}px`);
            validateMapOverlayLayout();
        };
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(update);
            observer.observe(stack);
            if (summary) observer.observe(summary);
            const apiNotice = document.getElementById('api-status-banner');
            if (apiNotice) observer.observe(apiNotice);
        }
        window.addEventListener('resize', update, { passive: true });
        window.__solarlessValidateMapOverlays = validateMapOverlayLayout;
        update();
    }

    function getRouteAnnouncementText(mode, isReroute = false) {
        const isKo = I18n.getLanguage().startsWith('ko');
        let targetRoute = null;
        if (routeData && routeData.routes) {
            targetRoute = routeData.routes[mode];
        }
        if (!targetRoute && selectedRouteObj) {
            targetRoute = selectedRouteObj;
        }

        const uvCut = targetRoute && Number.isFinite(Number(targetRoute.solarExposureReductionPct))
            ? Number(targetRoute.solarExposureReductionPct)
            : ((targetRoute && typeof targetRoute.uvReductionPct === 'number') ? targetRoute.uvReductionPct : 0);
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
                    `태양 노출 추정치를 ${uvCut}% 낮춘 ${modeNameKo}로 새로 탐색하여 안내를 시작합니다.` :
                    `Rerouting guidance to ${modeNameEn}, with an estimated ${uvCut}% lower solar exposure.`;
            } else {
                return isKo ?
                    `태양 노출 추정치를 ${uvCut}% 낮춘 ${modeNameKo}로 안내를 시작합니다.` :
                    `Starting guidance on ${modeNameEn}, with an estimated ${uvCut}% lower solar exposure.`;
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

        // Use the same base map in every UI language. Language switching
        // changes UI/voice/search presentation, not the map geometry/style.
        lightTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
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

        currentTileLayer = lightTileLayer;
        currentTileLayer.addTo(map);

        OfflineMap.registerOfflineTileCache(lightTileLayer);

        activeRoutePolylineGroup = L.featureGroup().addTo(map);
        dynamicRemainingPolylineGroup = L.featureGroup().addTo(map);

        disableMapEventsOnUI();
        const attribution = document.getElementById('map-attribution');
        if (attribution) L.DomEvent.disableClickPropagation(attribution);
        setupMapOverlayLayout();

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
        TTSVoice.setLanguage(I18n.getLanguage()); // Sync TTS voice language with detected UI language on startup
        updateSunInfo();
        setupSolarRefreshTimer();
        renderFavorites();
        renderRecentDestinationHistory();
        updateModeButtonsHighlight();
        setNavigationButtonsEnabled(false);
        setupNativeLocationPermissionState();
        setupPipUi();
        if (window.DebugLogger) window.DebugLogger.init();

        setTimeout(checkGitHubLatestVersion, 2500);
    }

    /* MAP PANNING TRACKING & SHORT AUTO RECENTER COUNTDOWN TOAST */
    function resetRecenterInactivityTimer() {
        clearTimeout(recenterWaitTimer);
        clearInterval(recenterCountdownInterval);
        hideRecenterToast();

        if (!isLiveNavActive || !isUserMapPanning) return;

        // If sidebar drawer is active or modal is open, do NOT trigger countdown
        const sidebar = document.getElementById('sidebar-panel');
        if (sidebar && sidebar.classList.contains('active')) return;
        const hasOpenModal = document.querySelector('.modal.active, .start-search-overlay:not(.hidden)');
        if (hasOpenModal) return;

        // Return to active guidance after a short exploration pause. Eight
        // seconds is long enough to inspect nearby roads without leaving the
        // driver permanently detached from the vehicle marker.
        recenterWaitTimer = setTimeout(triggerRecenterCountdownToast, 8000);
    }

    function setupMapPanTrackingListeners() {
        if (!map) return;

        installManualMapRotationGesture();
        installHeadingUpInteractionCompensation();

        const onUserPan = () => {
            markUserMapPanning();
        };

        map.on('dragstart', onUserPan);
        map.on('drag', () => {
            if (isUserMapPanning) resetRecenterInactivityTimer();
        });
        map.on('dragend', () => {
            if (isUserMapPanning) resetRecenterInactivityTimer();
        });
        map.on('zoomstart', event => {
            if (event && event.originalEvent) onUserPan();
        });
        map.on('zoomend', () => {
            if (isUserMapPanning) resetRecenterInactivityTimer();
        });
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

    function markUserMapPanning() {
        if (!isLiveNavActive) return;
        isUserMapPanning = true;
        const btnGps = document.getElementById('btn-recenter-gps');
        if (btnGps) btnGps.classList.add('panned');

        // Keep heading-up rotation while the user explores the map. Automatic
        // recentering is paused, then resumed after the inactivity countdown.
        const wrapper = document.getElementById('map-perspective-wrapper');
        if (wrapper) wrapper.classList.add('user-map-panning');
        resetRecenterInactivityTimer();
    }

    /**
     * The heading-up view is a CSS rotation of Leaflet's container while
     * Leaflet itself keeps an unrotated coordinate system. Use one final
     * visual angle for every input: tap/pinch centers are inverse-mapped by
     * mouseEventToContainerPoint and drag vectors are inverse-rotated once at
     * the predrag seam. Native Android event objects are never mutated.
     */
    function installHeadingUpInteractionCompensation() {
        const container = map && map.getContainer ? map.getContainer() : null;
        if (!container || container.__headingUpInteractionCompensationInstalled) return;
        container.__headingUpInteractionCompensationInstalled = true;

        const rotatePointToMapCoordinates = (x, y, angleDeg) => {
            const rect = container.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            // getBoundingClientRect() is the axis-aligned box *after* CSS
            // rotation. Leaflet, however, expects a point in the element's
            // original layout box. Use clientWidth/clientHeight for that
            // logical box, then add the transformed rect origin back so
            // Leaflet's own rect subtraction produces the right local point.
            const layoutWidth = container.clientWidth || rect.width;
            const layoutHeight = container.clientHeight || rect.height;
            const logicalPoint = window.RouteState && typeof window.RouteState.screenPointToRotatedLayout === 'function'
                ? window.RouteState.screenPointToRotatedLayout(x, y, cx, cy, layoutWidth, layoutHeight, angleDeg)
                : { x: x - rect.left, y: y - rect.top };
            return {
                clientX: rect.left + (container.clientLeft || 0) + logicalPoint.x,
                clientY: rect.top + (container.clientTop || 0) + logicalPoint.y
            };
        };

        // Android WebView can expose read-only native Touch/PointerEvent
        // properties. Keep a Leaflet-level fallback so pinch/zoom handlers
        // still receive logical container points even when event patching is
        // rejected by the platform.
        const originalMouseEventToContainerPoint = map && typeof map.mouseEventToContainerPoint === 'function'
            ? map.mouseEventToContainerPoint.bind(map) : null;
        const isRotationActive = () => lastAppliedMapRotation !== null &&
            (compassMode === 'heading-up' || Math.abs(manualMapRotation) >= 0.1);
        if (originalMouseEventToContainerPoint) {
            map.mouseEventToContainerPoint = event => {
                if (!isRotationActive()) {
                    return originalMouseEventToContainerPoint(event);
                }
                const source = event && event.touches && event.touches.length
                    ? event.touches[0]
                    : (event && event.changedTouches && event.changedTouches.length ? event.changedTouches[0] : event);
                if (!source || !Number.isFinite(source.clientX) || !Number.isFinite(source.clientY)) {
                    return originalMouseEventToContainerPoint(event);
                }
                const rect = container.getBoundingClientRect();
                const mapped = rotatePointToMapCoordinates(source.clientX, source.clientY, Number(lastAppliedMapRotation) || 0);
                return L.point(
                    mapped.clientX - rect.left - (container.clientLeft || 0),
                    mapped.clientY - rect.top - (container.clientTop || 0)
                );
            };
        }

        // Leaflet's Draggable computes map-pane deltas directly from pointer
        // coordinates, bypassing mouseEventToContainerPoint. Correct the
        // pending delta at the predrag seam so a screen-space drag follows the
        // finger after the map is visually rotated. This also works when the
        // WebView seals native event coordinates.
        const draggable = map && map.dragging && map.dragging._draggable;
        if (draggable && typeof draggable.on === 'function') {
            draggable.on('predrag', event => {
                if (!isRotationActive() || !draggable._startPos || !draggable._newPos) return;
                const dx = draggable._newPos.x - draggable._startPos.x;
                const dy = draggable._newPos.y - draggable._startPos.y;
                const logical = window.RouteState.inverseRotateScreenDelta(dx, dy, Number(lastAppliedMapRotation) || 0);
                draggable._newPos = draggable._startPos.add(L.point(logical.x, logical.y));
                if (draggable._absPos) draggable._absPos = draggable._startPos.add(L.point(logical.x, logical.y));
            });
        }
    }

    /**
     * Leaflet does not rotate its map on its own. Keep two-finger rotation as
     * a lightweight visual transform while leaving Leaflet's native pinch and
     * pan handlers active, so users can rotate, move, and zoom in one gesture.
     */
    function installManualMapRotationGesture() {
        const container = map && map.getContainer ? map.getContainer() : null;
        if (!container || container.__manualMapRotationGestureInstalled) return;
        container.__manualMapRotationGestureInstalled = true;
        let gesture = null;

        const readTouchPair = event => {
            const touches = event && event.touches;
            if (!touches || touches.length < 2) return null;
            return [touches[0], touches[1]];
        };
        const touchAngle = pair => Math.atan2(pair[1].clientY - pair[0].clientY, pair[1].clientX - pair[0].clientX) * 180 / Math.PI;
        const angleDelta = (next, previous) => ((next - previous + 540) % 360) - 180;

        container.addEventListener('touchstart', event => {
            const pair = readTouchPair(event);
            if (!pair) return;
            markUserMapPanning();
            gesture = { startAngle: touchAngle(pair), startOffset: manualMapRotation };
            const wrapper = document.getElementById('map-perspective-wrapper');
            if (wrapper) wrapper.classList.add('manual-rotation-gesture');
        }, { capture: true, passive: true });

        container.addEventListener('touchmove', event => {
            if (!gesture) return;
            const pair = readTouchPair(event);
            if (!pair) return;
            manualMapRotation = gesture.startOffset + angleDelta(touchAngle(pair), gesture.startAngle);
            applyMapRotation(compassMode === 'heading-up' ? currentHeading : 0);
        }, { capture: true, passive: true });

        const finishGesture = event => {
            if (!gesture) return;
            if (event && event.touches && event.touches.length >= 2) return;
            gesture = null;
            const wrapper = document.getElementById('map-perspective-wrapper');
            if (wrapper) wrapper.classList.remove('manual-rotation-gesture');
        };
        container.addEventListener('touchend', finishGesture, { capture: true, passive: true });
        container.addEventListener('touchcancel', finishGesture, { capture: true, passive: true });
    }

    function triggerRecenterCountdownToast() {
        if (!isUserMapPanning || !isLiveNavActive) return;

        // Do NOT trigger countdown if user is viewing sidebar drawer or modal!
        const sidebar = document.getElementById('sidebar-panel');
        if (sidebar && sidebar.classList.contains('active')) return;
        const hasOpenModal = document.querySelector('.modal.active, .start-search-overlay:not(.hidden)');
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
        // Recenter is also the explicit way out of a manual two-finger
        // rotation: restore the automatic heading-up orientation exactly.
        manualMapRotation = 0;
        lastAppliedMapRotation = null;

        // Close sidebar drawer when recentering so driver returns to clear navigation view
        setSidebarOpen(false);

        const btnGps = document.getElementById('btn-recenter-gps');
        if (btnGps) btnGps.classList.remove('panned');
        const wrapper = document.getElementById('map-perspective-wrapper');
        if (wrapper) wrapper.classList.remove('user-map-panning', 'manual-rotation-gesture');

        if (map && currentStart) {
            map.setView([currentStart.lat, currentStart.lng], isLiveNavActive ? NAVIGATION_ZOOM : 17, { animate: true });
            applyMapRotation(compassMode === 'heading-up' ? currentHeading : 0);
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
            setSidebarOpen(!(sidebar && sidebar.classList.contains('active')));
        };

        if (btnMobileToggle) {
            btnMobileToggle.addEventListener('click', toggleSidebar);
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

                // Re-evaluate dark/satellite state. The normal road layer is
                // deliberately identical in Korean and English.
                checkAndUpdateMapTileTheme();

                // Refresh Compass Mode Tag Text
                const compassTag = document.getElementById('compass-mode-tag');
                if (compassTag) {
                    compassTag.innerText = compassMode === 'heading-up' ? I18n.getText('compassHeading') : I18n.getText('compassNorth');
                }

                // Update Mobile Turn Banner Language if Active
                updateTurnBannerText(null, 0.05);

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

    /* FIND NEXT UPCOMING TURN MANEUVER FROM CURRENT VEHICLE POSITION */
    function findNextManeuver(carLat, carLng) {
        if (!selectedRouteObj || !selectedRouteObj.maneuvers || selectedRouteObj.maneuvers.length === 0) {
            return null;
        }

        const maneuvers = selectedRouteObj.maneuvers;
        const routeCoords = selectedRouteObj.analyzed && Array.isArray(selectedRouteObj.analyzed.coordinates)
            ? selectedRouteObj.analyzed.coordinates : null;
        let currentRouteIndex = -1;
        if (routeCoords && routeCoords.length > 1 && ShadowRouter.snapPositionAndHeadingToRoad) {
            const snap = isLiveNavActive
                ? snapNavigationPosition(carLat, carLng, currentHeading, selectedRouteObj)
                : ShadowRouter.snapPositionAndHeadingToRoad(carLat, carLng, currentHeading, routeCoords);
            currentRouteIndex = Number.isFinite(Number(snap && snap.segmentIndex)) ? Number(snap.segmentIndex) : -1;
        }

        // OSRM returns maneuvers in route order.  Use that order (rather than
        // only the closest geographic point) so a turn that has just been
        // passed can never be selected again when the road doubles back.
        const routeIndexForManeuver = (maneuver) => {
            if (!routeCoords || routeCoords.length === 0 || !maneuver.location) return Infinity;
            let best = Infinity;
            let bestIndex = Infinity;
            for (let i = 0; i < routeCoords.length; i++) {
                const point = routeCoords[i];
                const dLat = Number(point[1]) - Number(maneuver.location[1]);
                const dLng = Number(point[0]) - Number(maneuver.location[0]);
                const score = dLat * dLat + dLng * dLng;
                if (score < best) {
                    best = score;
                    bestIndex = i;
                }
            }
            return bestIndex;
        };

        const candidates = [];

        for (let i = 0; i < maneuvers.length; i++) {
            const m = maneuvers[i];
            if (!m.location || m.location.length < 2) continue;

            const routeIndex = routeIndexForManeuver(m);
            if (currentRouteIndex >= 0 && Number.isFinite(routeIndex) && routeIndex < currentRouteIndex - 2) continue;

            // Distance from car to maneuver point
            const dist = ShadowRouter.calculateDistanceMeters(carLat, carLng, m.location[1], m.location[0]);

            // Only consider maneuvers AHEAD of us (within 2km, but skip ones behind us)
            if (dist < 2000) {
                // Check if maneuver is ahead by comparing bearing from car to maneuver vs current heading
                const bearingToManeuver = ShadowRouter.calculateBearing(carLat, carLng, m.location[1], m.location[0]);
                const headingDiff = Math.abs(((bearingToManeuver - currentHeading) % 360 + 540) % 360 - 180);

                // Accept if maneuver is roughly ahead (within 120° arc) OR very close (< 60m)
                if (headingDiff < 120 || dist < 60) {
                    candidates.push({ maneuver: m, distanceFromCar: dist, routeIndex });
                }
            }
        }

        candidates.sort((a, b) => {
            if (Number.isFinite(a.routeIndex) && Number.isFinite(b.routeIndex) && a.routeIndex !== b.routeIndex) {
                return a.routeIndex - b.routeIndex;
            }
            return a.distanceFromCar - b.distanceFromCar;
        });
        if (!candidates.length) return null;
        const selected = candidates[0];
        return { ...selected.maneuver, distanceFromCar: selected.distanceFromCar };
    }

    /* MANEUVER TYPE+MODIFIER → FONTAWESOME ICON MAPPING */
    function getManeuverIcon(type, modifier) {
        if (type === 'arrive') return '<i class="fa-solid fa-flag-checkered"></i>';
        if (type === 'roundabout' || type === 'rotary') return '<i class="fa-solid fa-rotate-right"></i>';
        if (type === 'merge') return '<i class="fa-solid fa-code-merge"></i>';
        if (type === 'fork') return '<i class="fa-solid fa-code-fork"></i>';

        const normalizedModifier = String(modifier || '').trim().toLowerCase();
        // Keep direction in a named class instead of relying on the
        // ambiguous orientation of arrow-turn-down plus inline transforms.
        // The CSS classes are mirrored in www/style.css and make left/right
        // deterministic in both the banner and PiP HUD.
        switch (normalizedModifier) {
            case 'left': return '<i class="fa-solid fa-arrow-turn-up maneuver-icon maneuver-left" aria-label="left turn"></i>';
            case 'right': return '<i class="fa-solid fa-arrow-turn-up maneuver-icon maneuver-right" aria-label="right turn"></i>';
            case 'slight left': return '<i class="fa-solid fa-arrow-up maneuver-icon maneuver-slight-left" aria-label="slight left"></i>';
            case 'slight right': return '<i class="fa-solid fa-arrow-up maneuver-icon maneuver-slight-right" aria-label="slight right"></i>';
            case 'sharp left': return '<i class="fa-solid fa-arrow-turn-up maneuver-icon maneuver-sharp-left" aria-label="sharp left"></i>';
            case 'sharp right': return '<i class="fa-solid fa-arrow-turn-up maneuver-icon maneuver-sharp-right" aria-label="sharp right"></i>';
            case 'uturn': return '<i class="fa-solid fa-arrow-turn-up maneuver-icon maneuver-uturn" aria-label="U-turn"></i>';
            case 'straight': return '<i class="fa-solid fa-arrow-up maneuver-icon maneuver-straight" aria-label="straight"></i>';
            default: return '<i class="fa-solid fa-arrow-up maneuver-icon maneuver-straight" aria-label="straight"></i>';
        }
    }

    /* TURN BANNER WITH MANEUVER + ESTIMATED GLARE POSSIBILITY OVERLAY */
    function updateTurnBannerText(nextManeuver, glareRisk) {
        const banner = document.getElementById('mobile-turn-banner');
        if (!banner) return;

        const isKo = I18n.getLanguage().startsWith('ko');
        const bannerDist = document.getElementById('banner-dist');
        const bannerDesc = document.getElementById('banner-desc');
        const bannerIcon = document.getElementById('banner-turn-icon');

        if (nextManeuver && nextManeuver.type !== 'arrive') {
            const dist = nextManeuver.distanceFromCar || 0;
            const formattedDist = dist >= 1000
                ? (dist / 1000).toFixed(1) + 'km'
                : Math.round(dist) + 'm';
            const distPrefix = isKo ? `${formattedDist} 앞` : `In ${formattedDist}`;

            if (bannerDist) bannerDist.innerText = distPrefix;

            // Turn instruction text
            const turnText = TTSVoice.getManeuverText(nextManeuver.type, nextManeuver.modifier);
            const roadName = nextManeuver.name || '';

            let descText;
            if (isKo) {
                descText = roadName
                    ? `${roadName} ${I18n.getText('turnToward')} ${turnText}`
                    : turnText;
            } else {
                descText = roadName
                    ? `${turnText} ${I18n.getText('turnToward')} ${roadName}`
                    : turnText;
            }

            // Glare overlay warning
            if (glareRisk > 0.45) {
                descText += isKo ? ' ☀️ 역광주의' : ' ☀️ Glare';
                banner.classList.add('hazard');
            } else {
                banner.classList.remove('hazard');
            }

            if (bannerDesc) bannerDesc.innerText = descText;
            if (bannerIcon) bannerIcon.innerHTML = getManeuverIcon(nextManeuver.type, nextManeuver.modifier);
            updatePipHud(
                descText,
                document.getElementById('sum-time')?.innerText || '--',
                formattedDist,
                getManeuverIcon(nextManeuver.type, nextManeuver.modifier),
                glareRisk > 0.45,
                document.getElementById('sum-dist')?.innerText || '--'
            );
        } else {
            // No upcoming maneuver or arrived — show glare/safe status
            const formattedDist = '—';
            if (bannerDist) bannerDist.innerText = formattedDist;

            if (glareRisk > 0.45) {
                if (bannerDesc) bannerDesc.innerText = I18n.getText('turnBannerGlare');
                banner.classList.add('hazard');
                if (bannerIcon) bannerIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            } else {
                if (bannerDesc) bannerDesc.innerText = I18n.getText('turnBannerSafe');
                banner.classList.remove('hazard');
                if (bannerIcon) bannerIcon.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
            }
            updatePipHud(
                bannerDesc ? bannerDesc.innerText : '--',
                document.getElementById('sum-time')?.innerText || '--',
                formattedDist,
                bannerIcon ? bannerIcon.innerHTML : '<i class="fa-solid fa-arrow-up"></i>',
                glareRisk > 0.45,
                document.getElementById('sum-dist')?.innerText || '--'
            );
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
            targetTileLayer = lightTileLayer;

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
        let results = [];
        try {
            results = await Geocoder.searchPlaces(restQuery, currentStart, { includeNominatim: true });
        } catch (e) {
            if (btn) btn.innerHTML = `<i class="fa-solid fa-umbrella"></i> <span>${I18n.getText('shadedRestBtn')}</span>`;
            alert(I18n.getText(e && e.messageKey ? e.messageKey : 'searchNetworkError'));
            return;
        }

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
            const iconClass = String(fav.icon || 'fa-star').replace(/[^a-z0-9-]/gi, '');
            const displayName = getLocalizedFavName(fav);
            const icon = document.createElement('i');
            icon.className = `fa-solid ${iconClass || 'fa-star'}`;
            const label = document.createElement('span');
            label.textContent = displayName;
            chip.append(icon, document.createTextNode(' '), label);

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

                        let results = [];
                        try {
                            results = await Geocoder.searchPlaces(place.trim(), currentStart, { includeNominatim: true });
                        } catch (e) {
                            if (btn) btn.innerHTML = `<i class="fa-solid fa-route"></i> ${I18n.getText('confirmStartBtn')}`;
                            alert(I18n.getText(e && e.messageKey ? e.messageKey : 'searchNetworkError'));
                            return;
                        }
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

            let results = [];
            try {
                results = await Geocoder.searchPlaces(addr.trim(), currentStart, { includeNominatim: true });
            } catch (e) {
                alert(I18n.getText(e && e.messageKey ? e.messageKey : 'searchNetworkError'));
                return;
            }
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
                setSidebarOpen(false);
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
            const info = document.createElement('div');
            info.className = 'history-item-info';
            const historyIcon = document.createElement('i');
            historyIcon.className = 'fa-solid fa-clock-rotate-left';
            const historyName = document.createElement('span');
            historyName.className = 'history-item-name';
            historyName.textContent = String(item.name || '');
            info.append(historyIcon, historyName);
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'remove-history-btn';
            removeButton.title = isKo ? '삭제' : 'Delete';
            const removeIcon = document.createElement('i');
            removeIcon.className = 'fa-solid fa-xmark';
            removeButton.appendChild(removeIcon);
            row.append(info, removeButton);

            info.addEventListener('click', () => {
                currentEnd = item.coords;
                destinationName = item.name;
                document.getElementById('destination-input').value = item.name;
                document.getElementById('btn-confirm-destination').disabled = false;
                startNavigationFlow();
            });

            removeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                removeDestinationHistoryItem(item.name);
            });

            container.appendChild(row);
        });
    }

    function stopGpsWatch() {
        if (gpsWatchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(gpsWatchId);
        }
        gpsWatchId = null;
        stopVehicleMarkerAnimation();
    }

    async function enableKeepAwake() {
        if (!navigator.wakeLock || document.visibilityState === 'hidden' || !isLiveNavActive) return;
        if (wakeLockSentinel && !wakeLockSentinel.released) return;

        try {
            const sentinel = await navigator.wakeLock.request('screen');
            if (!isLiveNavActive || document.visibilityState === 'hidden') {
                await sentinel.release().catch(() => {});
                return;
            }
            wakeLockSentinel = sentinel;
            wakeLockSentinel.addEventListener('release', () => {
                wakeLockSentinel = null;
            }, { once: true });
        } catch (e) {
            wakeLockSentinel = null;
            console.warn("KeepAwake warning:", e);
        }
    }

    async function disableKeepAwake() {
        const sentinel = wakeLockSentinel;
        wakeLockSentinel = null;
        if (!sentinel || sentinel.released) return;
        try {
            await sentinel.release();
        } catch (e) {
            console.warn("KeepAwake release warning:", e);
        }
    }

    async function applyNativeLastLocationOnResume() {
        if (!isLiveNavActive || !window.PipController || typeof window.PipController.getLastNavigationLocation !== 'function') return;
        try {
            const last = await window.PipController.getLastNavigationLocation();
            if (!last || !last.available || !Number.isFinite(Number(last.lat)) || !Number.isFinite(Number(last.lng))) return;
            const process = window.__solarlessProcessNavigationPosition;
            if (typeof process === 'function') {
                process({
                    coords: {
                        latitude: Number(last.lat), longitude: Number(last.lng),
                        accuracy: Number(last.accuracy), speed: Number.isFinite(Number(last.speed)) ? Number(last.speed) : null,
                        heading: Number.isFinite(Number(last.heading)) ? Number(last.heading) : null
                    },
                    timestamp: Number(last.timestamp)
                }, `native-resume-${last.provider || 'location'}`);
                if (window.DebugLogger) window.DebugLogger.log('native-last-location-applied', { ageMs: Number(last.ageMs) || 0 });
            }
        } catch (error) {
            if (window.DebugLogger) window.DebugLogger.log('native-last-location-error', { message: String(error && error.message || error) });
        }
    }

    function setupAppResumeListener() {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
                if (!state.isActive) {
                    // Android may revoke a screen WakeLock when the WebView is
                    // backgrounded. Release our sentinel explicitly as well.
                    disableKeepAwake();
                    stopVehicleMarkerAnimation();
                    return;
                }
                if (isLiveNavActive) enableKeepAwake();
                if (isLiveNavActive && targetSnapLat !== null) startVehicleMarkerAnimationLoop();
                applyNativeLastLocationOnResume();
                if (currentEnd) {
                    console.log("App resumed to foreground. Refreshing GPS position...");
                    requestUserGpsLocation(false).catch(() => {});
                }
            });
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                disableKeepAwake();
                stopVehicleMarkerAnimation();
            }
            else {
                if (isLiveNavActive) enableKeepAwake();
                if (isLiveNavActive && targetSnapLat !== null) startVehicleMarkerAnimationLoop();
                applyNativeLastLocationOnResume();
                updateSunInfo();
            }
        });
        window.addEventListener('pagehide', () => {
            disableKeepAwake();
            stopVehicleMarkerAnimation();
        });
    }

    async function setupNativeLocationPermissionState() {
        // Android/WebView owns the actual permission prompt. The app keeps no
        // duplicate onboarding dialog; it only reads the current state so an
        // already granted permission is not requested or explained twice.
        const update = async () => {
            let state = 'prompt';
            let nativePermission = null;
            try {
                if (window.PipController && typeof window.PipController.getLocationPermissionState === 'function') {
                    nativePermission = await window.PipController.getLocationPermissionState();
                    if (nativePermission && nativePermission.granted) {
                        state = nativePermission.fine ? 'fine-granted' : 'coarse-granted';
                    } else if (nativePermission && nativePermission.denied) {
                        state = 'denied';
                    }
                }
                if ((!nativePermission || !nativePermission.granted) && navigator.permissions && navigator.permissions.query) {
                    state = (await navigator.permissions.query({ name: 'geolocation' })).state;
                }
            } catch (e) { /* Some Android WebViews do not expose Permissions API. */ }
            gpsPermissionState = state;
            if (window.DebugLogger) window.DebugLogger.log('location-permission-state', { state });
            if (['granted', 'fine-granted', 'coarse-granted'].includes(state) && !currentStart && !gpsFixPromise) {
                requestUserGpsLocation(true).catch(() => {});
            }
        };
        await update();
        window.addEventListener('pageshow', update);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') update(); });
    }

    function setupPipUi() {
        if (!window.PipController) return;
        window.addEventListener('solarless:pipdebug', event => {
            const detail = event && event.detail ? event.detail : {};
            if (window.DebugLogger) window.DebugLogger.log('pip-debug', detail);
            const reason = String(detail.reason || '');
            if (isLiveNavActive && ['LOCATION_PERMISSION_MISSING', 'LOCATION_SERVICE_START_FAILED', 'LOCATION_SERVICE_NO_PROVIDER'].includes(reason)) {
                showApiNotice(I18n.getLanguage().startsWith('ko')
                    ? 'Android 백그라운드 위치 서비스를 사용할 수 없습니다. 앱을 열어 둔 상태에서 GPS 안내를 계속합니다.'
                    : 'Android background location is unavailable. GPS guidance will continue while the app remains open.');
            }
        });
        window.addEventListener('solarless:pipmode', event => {
            isPipMode = !!(event && event.detail && event.detail.inPip);
            if (map) setTimeout(() => map.invalidateSize({ animate: false }), 80);
            if (isLiveNavActive && targetSnapLat !== null) startVehicleMarkerAnimationLoop();
        });
        const toggle = document.getElementById('toggle-pip-auto');
        const status = document.getElementById('pip-support-status');
        const settings = document.getElementById('btn-pip-settings');
        if (toggle) {
            toggle.checked = window.PipController.getAutoEnter();
            toggle.addEventListener('change', () => { window.PipController.setAutoEnter(toggle.checked); window.PipController.update(); });
        }
        if (settings) settings.addEventListener('click', () => window.PipController.openSettings());
        window.PipController.init().then(result => {
            if (status) status.textContent = result && result.supported
                ? (result.allowed === false ? `${I18n.getText('pipSupported')} (${result.reason || 'OS_PIP_BLOCKED'})` : I18n.getText('pipSupported'))
                : I18n.getText('pipUnsupported');
            if (window.DebugLogger) window.DebugLogger.log('pip-state', result || { reason: 'WEB_RUNTIME' });
        });
        if (typeof window.PipController.addListener === 'function') {
            window.PipController.addListener('locationUpdate', event => {
                if (!isLiveNavActive || !event || !Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lng))) return;
                const nativePosition = {
                    coords: {
                        latitude: Number(event.lat), longitude: Number(event.lng),
                        accuracy: Number(event.accuracy),
                        speed: Number.isFinite(Number(event.speed)) ? Number(event.speed) : null,
                        heading: Number.isFinite(Number(event.heading)) ? Number(event.heading) : null
                    },
                    timestamp: Number(event.timestamp) || Date.now()
                };
                const process = window.__solarlessProcessNavigationPosition;
                if (typeof process === 'function') process(nativePosition, `native-${event.source || 'location'}`);
                else applyGpsFix(nativePosition, `native-${event.source || 'location'}`);
            });
        }
    }

    function updatePipHud(nextText, etaText, distanceText, iconHtml, hazard = false, routeDistanceText) {
        const next = document.getElementById('pip-mini-next');
        const eta = document.getElementById('pip-mini-eta');
        const distance = document.getElementById('pip-mini-distance');
        const icon = document.getElementById('pip-mini-icon');
        const routeDistance = document.getElementById('pip-mini-route-distance');
        const nextLabel = document.getElementById('pip-mini-next-label');
        const hud = document.getElementById('pip-mini-hud');
        const isKo = I18n.getLanguage().startsWith('ko');
        if (next && nextText !== undefined) next.textContent = nextText;
        if (eta && etaText !== undefined) eta.textContent = `${isKo ? '도착' : 'ETA'} ${etaText}`;
        if (distance && distanceText !== undefined) distance.textContent = distanceText;
        if (routeDistance && routeDistanceText !== undefined) routeDistance.textContent = `${isKo ? '남은' : 'Remain'} ${routeDistanceText}`;
        if (nextLabel) nextLabel.textContent = isKo ? '다음 안내' : 'Next maneuver';
        // getManeuverIcon() only returns static FontAwesome markup; external
        // road/place names are always assigned through textContent above.
        if (icon && iconHtml !== undefined) icon.innerHTML = iconHtml;
        if (hud) hud.classList.toggle('hazard', !!hazard);
    }

    function setupSolarRefreshTimer() {
        clearInterval(solarRefreshTimer);
        solarRefreshTimer = setInterval(() => {
            if (document.visibilityState !== 'hidden') updateSunInfo();
        }, 60000);
        window.addEventListener('pagehide', () => {
            clearInterval(solarRefreshTimer);
            solarRefreshTimer = null;
        }, { once: true });
        window.addEventListener('pageshow', () => {
            if (!solarRefreshTimer) setupSolarRefreshTimer();
        }, { once: true });
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
            setSidebarOpen(false);
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

    function updateGpsAccuracyCircle(lat, lng, accuracy) {
        if (!map || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
        const radius = Number.isFinite(Number(accuracy)) && Number(accuracy) > 0 ? Math.min(5000, Number(accuracy)) : 0;
        if (!gpsAccuracyCircle) {
            gpsAccuracyCircle = L.circle([lat, lng], {
                radius,
                color: '#38bdf8',
                weight: 1,
                fillColor: '#38bdf8',
                fillOpacity: 0.12,
                opacity: radius > 0 ? 0.75 : 0
            }).addTo(map);
        } else {
            gpsAccuracyCircle.setLatLng([lat, lng]);
            gpsAccuracyCircle.setRadius(radius);
            gpsAccuracyCircle.setStyle({ opacity: radius > 0 ? 0.75 : 0, fillOpacity: radius > 0 ? 0.12 : 0 });
        }
        const status = document.getElementById('header-gps-status');
        if (status) {
            const ageSec = Math.max(0, Math.round((Date.now() - gpsLastFixAt) / 1000));
            status.title = radius > 0
                ? `${gpsLastFixSource} · ±${Math.round(radius)}m · ${ageSec}s`
                : `${gpsLastFixSource} · ${ageSec}s`;
        }
    }

    function applyGpsFix(pos, source = 'web') {
        const coords = pos && pos.coords;
        const lat = Number(coords && coords.latitude);
        const lng = Number(coords && coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid GPS fix');
        const accuracy = Number(coords.accuracy);
        if (Number.isFinite(Number(coords.heading)) && Number(coords.heading) >= 0) {
            currentHeading = Number(coords.heading);
            hasValidGpsHeading = true;
        }
        const timestamp = Number(pos && pos.timestamp) > 0 ? Number(pos.timestamp) : Date.now();
        currentStart = { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null, timestamp };
        gpsLastFixSource = source || 'web';
        gpsLastFixAt = timestamp;
        gpsPermissionState = gpsPermissionState === 'fine-granted' ? 'fine-granted' : 'coarse-granted';
        gpsFixState = 'ready';
        gpsLastError = null;
        setGpsStatusIndicator(false, true);
        updateGpsAccuracyCircle(lat, lng, accuracy);
        if (window.DebugLogger) window.DebugLogger.log('gps-fix', {
            source: gpsLastFixSource,
            position: { lat, lng },
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            ageMs: 0
        });
        return currentStart;
    }

    function requestUserGpsLocation(isInitial = false) {
        if (!navigator.geolocation) {
            gpsFixState = 'unavailable';
            setGpsStatusIndicator(false, false);
            const unavailable = new Error('Geolocation is not supported on this device.');
            unavailable.code = 'UNAVAILABLE';
            return Promise.reject(unavailable);
        }

        if (gpsFixPromise) return gpsFixPromise;
        gpsFixState = 'pending';

        setGpsStatusIndicator(true, false);

        const acquirePosition = window.RouteState && typeof window.RouteState.acquireInitialPosition === 'function'
            ? window.RouteState.acquireInitialPosition(navigator.geolocation)
            : new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
                resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
            ));

        gpsFixPromise = acquirePosition.then((pos) => {
                const previousTimestamp = gpsLastFixAt;
                const initialTimestamp = Number(pos && pos.timestamp) > 0 ? Number(pos.timestamp) : Date.now();
                const source = pos && pos.coords && Number.isFinite(Number(pos.coords.accuracy)) && Number(pos.coords.accuracy) < 100
                    ? 'high-accuracy' : 'last-known/network';
                applyGpsFix(pos, source);
                const lat = currentStart.lat;
                const lng = currentStart.lng;
                // If a destination was already selected by a resume/GPS
                // refresh flow, preserve the previous behavior of starting a
                // route as soon as the first valid fix arrives. A normal
                // startNavigationFlow() call sets navigationStartPending and
                // owns that first request, so this guard cannot duplicate it.
                const shouldRefreshExistingRoute = !!currentEnd && !navigationStartPending;
                if (shouldRefreshExistingRoute) updateRoute();

                // Reverse geocoding is UI enrichment and must not block route
                // readiness or the caller waiting for the first valid fix.
                Promise.resolve().then(async () => {
                    let addr = '';
                    try { addr = await Geocoder.reverseGeocode(lat, lng); } catch (e) { /* GPS fix remains valid if address lookup fails. */ }
                    const input = document.getElementById('origin-input');
                    const myLocLabel = I18n.getLanguage().startsWith('ko') ? "🎯 내 위치" : "🎯 My Location";
                    if (input) input.value = `${myLocLabel}: ${addr}`;

                    updateSunInfo();
                    checkAndUpdateMapTileTheme();

                    if (!currentEnd && map) {
                        map.setView([currentStart.lat, currentStart.lng], 16);
                        updateVehicleMarkerPosition(currentStart.lat, currentStart.lng, currentHeading);
                    }
                });

                // A quick network/last-known fix makes the first screen
                // responsive. Follow it with one high-accuracy fix without
                // delaying route preparation or opening another permission UI.
                if (source !== 'high-accuracy' && navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(refined => {
                        const refinedAccuracy = Number(refined && refined.coords && refined.coords.accuracy);
                        const refinedTimestamp = Number(refined && refined.timestamp) || 0;
                        const currentAccuracy = currentStart && Number(currentStart.accuracy);
                        const baselineTimestamp = Math.max(previousTimestamp || 0, initialTimestamp || 0);
                        const isNewer = !refinedTimestamp || refinedTimestamp >= baselineTimestamp;
                        if (isNewer && (!Number.isFinite(currentAccuracy) || !Number.isFinite(refinedAccuracy) || refinedAccuracy <= currentAccuracy)) {
                            applyGpsFix(refined, 'high-accuracy');
                            const dateObj = isRealTimeMode ? new Date() : getDateFromMinutes(selectedTimeMinutes);
                            const refinedKey = getCurrentRouteRequestKey(dateObj);
                            const routeIdentityInFlight = activeRouteRequestKey || verifiedRouteRequestKey;
                            const restartPendingRoute = window.RouteState &&
                                typeof window.RouteState.shouldRestartRouteForGpsFix === 'function' &&
                                window.RouteState.shouldRestartRouteForGpsFix(
                                    routeIdentityInFlight, refinedKey, !!currentEnd, isLiveNavActive
                                );
                            // A refined fix changes the request identity. Do
                            // not let the old-origin result render while the
                            // start button compares against the new origin.
                            // updateRoute() aborts that request and replaces it
                            // exactly once with the refined position.
                            if (restartPendingRoute) updateRoute();
                        }
                    }, () => {}, { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 });
                }
                return currentStart;
            }).catch((err) => {
                gpsFixState = 'error';
                gpsLastError = err && err.code;
                // Do not infer a permanent permission denial from a single
                // WebView code-1 callback. Android can emit it while the
                // permission result is settling; the Permissions API state
                // (when available) is the source of truth for the alert.
                setGpsStatusIndicator(false, false);
                if (isInitial) {
                    document.getElementById('origin-input').value = I18n.getLanguage().startsWith('ko') ? "🎯 내 위치 (현재 GPS)" : "🎯 My Location (Current GPS)";
                }
                updateSunInfo();
                checkAndUpdateMapTileTheme();
                if (window.DebugLogger) window.DebugLogger.log('gps-error', { code: err && err.code, source: isInitial ? 'initial' : 'request' });
                const gpsError = new Error(err && err.code === 1 ? 'Location permission was denied.' : 'Current GPS position is not available yet.');
                gpsError.code = err && err.code;
                throw gpsError;
            }).finally(() => { gpsFixPromise = null; });
        return gpsFixPromise;
    }

    let currentSmoothLat = null;
    let currentSmoothLng = null;
    let currentSmoothHeading = 0;
    let targetSnapLat = null;
    let targetSnapLng = null;
    let targetSnapHeading = 0;
    let vehicleAnimFrameId = null;
    let vehicleAnimationStartedAt = 0;
    let vehicleAnimationFrom = null;
    let lastVehicleMapPanAt = 0;
    let lastAppliedMapRotation = null;
    let manualMapRotation = 0;
    let stableGpsHeading = 0;
    let lastStableMovingGps = null;
    let hasValidGpsHeading = false;

    function stopVehicleMarkerAnimation() {
        if (vehicleAnimFrameId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(vehicleAnimFrameId);
        }
        vehicleAnimFrameId = null;
        vehicleAnimationStartedAt = 0;
        vehicleAnimationFrom = null;
    }

    function prefersReducedMotion() {
        return isBatterySaverActive || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function renderVehicleMarker() {
        if (!map || currentSmoothLat === null || currentSmoothLng === null) return;
        if (!startMarker) {
            const vehicleIcon = L.divIcon({
                className: 'custom-vehicle-marker',
                html: `<div class="vehicle-marker-wrapper"><div class="vehicle-radar-cone"></div><div class="vehicle-marker-core"><svg class="vehicle-svg-arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L4 21L12 17L20 21L12 2Z" fill="#ffffff" stroke="#0369a1" stroke-width="1.5" stroke-linejoin="round"/></svg></div></div>`,
                iconSize: [48, 48],
                iconAnchor: [24, 24]
            });
            startMarker = L.marker([currentSmoothLat, currentSmoothLng], { icon: vehicleIcon }).addTo(map);
        } else {
            startMarker.setLatLng([currentSmoothLat, currentSmoothLng]);
        }
        const markerElement = startMarker.getElement && startMarker.getElement();
        if (markerElement) {
            const cone = markerElement.querySelector('.vehicle-radar-cone');
            const core = markerElement.querySelector('.vehicle-marker-core');
            if (cone) cone.style.transform = `rotate(${currentSmoothHeading}deg)`;
            if (core) core.style.transform = `rotate(${currentSmoothHeading}deg)`;
        }
        const carArrow = document.getElementById('car-heading-arrow');
        if (carArrow) carArrow.style.transform = `translate(-50%, -50%) rotate(${currentSmoothHeading}deg)`;
        const now = Date.now();
        if (isLiveNavActive && !isUserMapPanning && map && now - lastVehicleMapPanAt >= 66) {
            lastVehicleMapPanAt = now;
            map.setView([currentSmoothLat, currentSmoothLng], 17.5, { animate: false });
            applyMapRotation(currentSmoothHeading);
        }
    }

    function startVehicleMarkerAnimationLoop() {
        if (targetSnapLat === null || targetSnapLng === null) return;
        if (!isLiveNavActive || prefersReducedMotion() || isPipMode) {
            currentSmoothLat = targetSnapLat;
            currentSmoothLng = targetSnapLng;
            currentSmoothHeading = targetSnapHeading;
            currentHeading = currentSmoothHeading;
            renderVehicleMarker();
            stopVehicleMarkerAnimation();
            return;
        }
        if (vehicleAnimFrameId !== null) return;
        vehicleAnimationFrom = {
            lat: currentSmoothLat === null ? targetSnapLat : currentSmoothLat,
            lng: currentSmoothLng === null ? targetSnapLng : currentSmoothLng,
            heading: currentSmoothLat === null ? targetSnapHeading : currentSmoothHeading
        };
        vehicleAnimationStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const animateFrame = (timestamp) => {
            if (!isLiveNavActive || (document.visibilityState === 'hidden' && !isPipMode) || targetSnapLat === null || targetSnapLng === null) {
                stopVehicleMarkerAnimation();
                return;
            }
            const now = Number(timestamp) || Date.now();
            const progress = Math.min(1, Math.max(0, (now - vehicleAnimationStartedAt) / 400));
            const from = vehicleAnimationFrom || { lat: targetSnapLat, lng: targetSnapLng, heading: targetSnapHeading };
            let headingDelta = ((targetSnapHeading - from.heading + 540) % 360) - 180;
            currentSmoothLat = from.lat + (targetSnapLat - from.lat) * progress;
            currentSmoothLng = from.lng + (targetSnapLng - from.lng) * progress;
            currentSmoothHeading = (from.heading + headingDelta * progress + 360) % 360;
            currentHeading = currentSmoothHeading;
            renderVehicleMarker();
            if (progress >= 1 || (Math.abs(targetSnapLat - currentSmoothLat) < 0.0000001 && Math.abs(targetSnapLng - currentSmoothLng) < 0.0000001 && Math.abs(headingDelta) < 0.5)) {
                currentSmoothLat = targetSnapLat;
                currentSmoothLng = targetSnapLng;
                currentSmoothHeading = targetSnapHeading;
                currentHeading = currentSmoothHeading;
                renderVehicleMarker();
                stopVehicleMarkerAnimation();
                return;
            }
            vehicleAnimFrameId = requestAnimationFrame(animateFrame);
        };
        vehicleAnimFrameId = requestAnimationFrame(animateFrame);
    }

    function renderDynamicRemainingPath(carLat, carLng, carHeading, knownSnap = null) {
        if (!selectedRouteObj || !selectedRouteObj.analyzed || !selectedRouteObj.analyzed.segments || !dynamicRemainingPolylineGroup) {
            return;
        }

        const coords = selectedRouteObj.analyzed.coordinates;
        const routeIdentity = getRouteGeometryIdentity(selectedRouteObj);
        const snap = knownSnap || ShadowRouter.snapPositionAndHeadingToRoad(carLat, carLng, carHeading, coords);
        if (selectedRouteObj.analyzed.segments.length === 0) return;
        const progressFloor = navigationRouteProgress.routeId === routeIdentity
            ? navigationRouteProgress.segmentIndex : 0;
        const segIdx = Math.max(progressFloor, Math.max(0, Math.min(selectedRouteObj.analyzed.segments.length - 1, snap.segmentIndex || 0)));
        const segments = selectedRouteObj.analyzed.segments;
        if (dynamicRemainingRouteId !== routeIdentity) {
            dynamicRemainingPolylineGroup.clearLayers();
            dynamicRemainingLayers = new Map();
            dynamicRemainingRouteId = routeIdentity;
            dynamicRemainingSegmentIndex = null;
        }
        const colorForSegment = seg => seg.glareRisk > 0.45
            ? '#f59e0b'
            : (seg.confirmedShade ? '#7c3aed'
                : (seg.shadeState === 'estimated-shade' && seg.shadeScore > 0.5 ? '#0e7490' : '#0284c7'));
        // Reuse one Leaflet layer per segment. GPS ticks update only the
        // current segment; unchanged future layers keep their DOM/SVG path.
        if (dynamicRemainingSegmentIndex === segIdx && dynamicRemainingLayers.size > 0) {
            const currentLayer = dynamicRemainingLayers.get(segIdx);
            if (currentLayer) currentLayer.setLatLngs([[snap.lat, snap.lng], segments[segIdx].p2]);
            const remDistMeters = ShadowRouter.calculateRemainingRouteDistance(snap.lat, snap.lng, coords, segIdx);
            const totalDist = selectedRouteObj.distanceMeters || 1;
            const remSec = Math.max(30, Math.round((remDistMeters / totalDist) * selectedRouteObj.durationSec));
            updateRemainingSummary(remSec, remDistMeters);
            return;
        }
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            let layer = dynamicRemainingLayers.get(i);
            if (!layer) {
                layer = L.polyline([], {
                    color: colorForSegment(seg), weight: 8, opacity: 0.95,
                    lineCap: 'round', lineJoin: 'round'
                }).addTo(dynamicRemainingPolylineGroup);
                dynamicRemainingLayers.set(i, layer);
            }
            if (i < segIdx) layer.setLatLngs([]);
            else if (i === segIdx) layer.setLatLngs([[snap.lat, snap.lng], seg.p2]);
            else layer.setLatLngs([seg.p1, seg.p2]);
        }
        dynamicRemainingSegmentIndex = segIdx;

        // 3. Dynamic remaining distance and ETA calculation
        const remDistMeters = ShadowRouter.calculateRemainingRouteDistance(snap.lat, snap.lng, coords, segIdx);
        const totalDist = selectedRouteObj.distanceMeters || 1;
        const remSec = Math.max(30, Math.round((remDistMeters / totalDist) * selectedRouteObj.durationSec));
        updateRemainingSummary(remSec, remDistMeters);
    }

    function updateVehicleMarkerPosition(lat, lng, heading = 0) {
        let snapResult = { lat, lng, heading, isSnapped: false, segmentIndex: 0 };

        if (selectedRouteObj && selectedRouteObj.analyzed && selectedRouteObj.analyzed.coordinates) {
            snapResult = isLiveNavActive
                ? snapNavigationPosition(lat, lng, heading, selectedRouteObj)
                : ShadowRouter.snapPositionAndHeadingToRoad(lat, lng, heading, selectedRouteObj.analyzed.coordinates);
        }

        targetSnapLat = snapResult.lat;
        targetSnapLng = snapResult.lng;
        targetSnapHeading = snapResult.heading;

        startVehicleMarkerAnimationLoop();

        if (isLiveNavActive && selectedRouteObj) {
            renderDynamicRemainingPath(snapResult.lat, snapResult.lng, snapResult.heading, snapResult);
        }
    }

    function toggleCompassMode() {
        const next = compassMode === 'heading-up' ? 'north-up' : 'heading-up';
        const isKo = I18n.getLanguage().startsWith('ko');
        compassModeUserOverride = true;
        setCompassMode(next);
        TTSVoice.speak(next === 'heading-up'
            ? (isKo ? '주행 방향 모드입니다.' : 'Heading-up mode activated.')
            : (isKo ? '북쪽 고정 모드입니다.' : 'North-up mode activated.'));
    }

    function applyMapRotation(heading) {
        const mapWrapper = document.getElementById('map-perspective-wrapper');
        const mapElement = document.getElementById('map');
        if (!mapElement || !mapWrapper) return;

        const baseRotation = compassMode === 'heading-up' ? (Number(heading) || 0) : 0;
        const visualRotation = ((baseRotation + manualMapRotation) % 360 + 360) % 360;
        const hasManualRotation = Math.abs(manualMapRotation) >= 0.1;
        if ((compassMode === 'heading-up' && heading !== undefined) || hasManualRotation) {
            if (!mapWrapper.classList.contains('heading-up-active')) {
                mapWrapper.classList.add('heading-up-active');
                if (map) map.invalidateSize();
            }
            // Rotation deadband filter: Only update DOM transform if angular delta is >= 1.0 degrees
            if (lastAppliedMapRotation === null || Math.abs(((visualRotation - lastAppliedMapRotation + 540) % 360) - 180) >= 1.0) {
                lastAppliedMapRotation = visualRotation;
                mapElement.style.transform = `rotate(${-visualRotation}deg)`;
                mapWrapper.style.setProperty('--map-counter-rotation', `${visualRotation}deg`);
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

    function setCompassMode(mode) {
        const next = mode === 'heading-up' ? 'heading-up' : 'north-up';
        compassMode = next;
        manualMapRotation = 0;
        const btn = document.getElementById('btn-toggle-compass');
        const tag = document.getElementById('compass-mode-tag');
        if (btn) btn.classList.toggle('heading-up', next === 'heading-up');
        if (tag) tag.innerText = next === 'heading-up' ? I18n.getText('compassHeading') : I18n.getText('compassNorth');
        applyMapRotation(next === 'heading-up' ? currentHeading : 0);
    }

    function setLiveNavigationMapMode(active) {
        const wrapper = document.getElementById('map-perspective-wrapper');
        if (!wrapper) return;
        const wasActive = wrapper.classList.contains('live-navigation');
        wrapper.classList.toggle('live-navigation', !!active);
        if (map && wasActive !== !!active) {
            // The live view uses an oversized rotated map so tile corners stay
            // covered. Preview remains normal-sized for reliable fitBounds().
            map.invalidateSize({ pan: false, debounceMoveend: true });
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

            let results = [];
            try {
                // Explicit submit: use both providers, including Nominatim.
                results = await Geocoder.searchPlaces(typedText, currentStart, { includeNominatim: true });
            } catch (e) {
                if (btn) btn.innerHTML = `<i class="fa-solid fa-route"></i> ${I18n.getText('confirmStartBtn')}`;
                alert(I18n.getText(e && e.messageKey ? e.messageKey : 'searchNetworkError'));
                return;
            }
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

    async function startNavigationFlow() {
        if (!currentEnd) return;
        if (currentStart) {
            startNavigationFlowAfterGps();
            return;
        }
        if (navigationStartPending) return;
        navigationStartPending = true;
        const isKo = I18n.getLanguage().startsWith('ko');
        try {
            await requestUserGpsLocation(false);
        } catch (e) {
            // Some Android WebViews report a transient code-1 geolocation
            // failure even after the native permission dialog was accepted.
            // Show the settings message only when the permission state is
            // explicitly denied; otherwise explain that a GPS fix is pending.
            if (e && e.code === 1 && gpsPermissionState === 'denied') {
                alert(isKo ? '위치 권한이 거부되었습니다. Android 설정에서 위치 권한을 허용해 주세요.' : 'Location permission was denied. Allow it in Android settings.');
            } else if (e && e.code === 'UNAVAILABLE') {
                alert(isKo ? '이 기기에서는 위치 정보를 사용할 수 없습니다.' : 'Location is not available on this device.');
            } else if (e && e.code === 'POSITION_UNCERTAIN') {
                alert(isKo
                    ? 'GPS 정확도가 낮아 자동차 안내를 시작할 수 없습니다. 창가나 실외에서 더 정확한 신호를 받은 뒤 다시 시도해 주세요.'
                    : 'GPS accuracy is too low to start driving guidance. Move near a window or outdoors and try again.');
            } else {
                alert(isKo ? 'GPS 위치를 아직 받지 못했습니다. 잠시 후 다시 시도해 주세요.' : 'The current GPS fix is not ready yet. Please try again shortly.');
            }
            return;
        } finally {
            navigationStartPending = false;
        }
        if (currentStart) startNavigationFlowAfterGps();
    }

    function startNavigationFlowAfterGps() {
        if (!currentEnd) return;
        if (!currentStart) {
            const isKo = I18n.getLanguage().startsWith('ko');
            alert(isKo ? '출발지 GPS 위치를 먼저 확인할 수 있어야 실제 경로를 계산할 수 있습니다.' : 'A GPS origin is required before a real road route can be calculated.');
            requestUserGpsLocation(false).catch(() => {});
            return;
        }

        saveDestinationHistory(destinationName, currentEnd);

        try {
            history.pushState({ navActive: true }, "SolarLess Navi", "#nav");
        } catch (e) {}

        document.getElementById('start-search-modal').classList.add('hidden');
        document.getElementById('bar-dest-text').innerText = destinationName || "Destination Set";

        // Do not allow navigation to start while a first real route is still pending.
        setNavigationButtonsEnabled(isCurrentRouteReady());
        updateRoute();
    }

    function openSearchModal() {
        renderFavorites();
        renderRecentDestinationHistory();
        document.getElementById('start-search-modal').classList.remove('hidden');
        setSidebarOpen(false);
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
        if (isRealTimeMode && routeData && Number.isFinite(Number(routeData.calculatedAt))) {
            const routeAgeMs = Date.now() - Number(routeData.calculatedAt);
            if (routeAgeMs >= 5 * 60 * 1000 && Date.now() - lastSolarStaleNotice >= 5 * 60 * 1000) {
                lastSolarStaleNotice = Date.now();
                showApiNotice(I18n.getLanguage().startsWith('ko')
                    ? '태양 위치 추정값이 오래되었습니다. 최신 값이 필요하면 경로를 다시 계산하세요.'
                    : 'Solar estimates are older than five minutes. Recalculate the route for fresh values.');
            }
        }
        return sunPos;
    }

    function getRouteCandidateCacheKey() {
        if (!currentStart || !currentEnd) return null;
        return [
            Number(currentStart.lat).toFixed(6), Number(currentStart.lng).toFixed(6),
            Number(currentEnd.lat).toFixed(6), Number(currentEnd.lng).toFixed(6),
            isTollFreeOnly ? 'toll-free' : 'standard'
        ].join('|');
    }

    function formatArrivalTime(remainingSec) {
        const arrival = new Date(Date.now() + Math.max(0, Number(remainingSec) || 0) * 1000);
        return arrival.toLocaleTimeString(I18n.getLanguage(), { hour: 'numeric', minute: '2-digit' });
    }

    function updateRemainingSummary(remainingSec, remainingMeters) {
        const isKo = I18n.getLanguage().startsWith('ko');
        const seconds = Math.max(30, Number(remainingSec) || 0);
        const arrivalEl = document.getElementById('sum-time');
        const durationEl = document.getElementById('sum-duration');
        const distanceEl = document.getElementById('sum-dist');
        const destinationEl = document.getElementById('sum-destination');
        if (arrivalEl) arrivalEl.innerText = formatArrivalTime(seconds);
        if (distanceEl) distanceEl.innerText = `${(Math.max(0, Number(remainingMeters) || 0) / 1000).toFixed(1)} km`;
        // Avoid the ambiguous single-letter "m", which is normally read as
        // metres in a driving HUD. Korean uses its full minute unit as well.
        if (durationEl) durationEl.innerText = `${Math.max(1, Math.round(seconds / 60))}${isKo ? '분' : ' min'}`;
        if (destinationEl) {
            destinationEl.innerText = destinationName || (isKo ? '목적지' : 'Destination');
            destinationEl.title = destinationName || '';
        }
        if (isLiveNavActive) ensureRouteSummaryCycling();
        else showRouteSummaryPage(0);
    }

    function showRouteSummaryPage(page) {
        routeSummaryCycleIndex = page === 1 ? 1 : 0;
        document.querySelectorAll('#route-summary-box [data-summary-page]').forEach(element => {
            element.classList.toggle('summary-page-visible', Number(element.dataset.summaryPage) === routeSummaryCycleIndex);
        });
    }

    function ensureRouteSummaryCycling() {
        showRouteSummaryPage(routeSummaryCycleIndex);
        if (routeSummaryCycleTimer !== null) return;
        routeSummaryCycleTimer = setInterval(() => {
            if (!isLiveNavActive) return;
            showRouteSummaryPage(routeSummaryCycleIndex === 0 ? 1 : 0);
        }, ROUTE_SUMMARY_CYCLE_MS);
    }

    function stopRouteSummaryCycling() {
        if (routeSummaryCycleTimer !== null) clearInterval(routeSummaryCycleTimer);
        routeSummaryCycleTimer = null;
        routeSummaryCycleIndex = 0;
        showRouteSummaryPage(0);
    }

    function getActiveRoadDestination() {
        return (selectedRouteObj && ShadowRouter.getRouteEndpoint(selectedRouteObj)) || currentEnd;
    }

    function markRouteCalculationPending(isPending) {
        const summary = document.getElementById('route-summary-box');
        if (summary) {
            summary.classList.toggle('calculating', !!isPending);
            summary.setAttribute('aria-busy', isPending ? 'true' : 'false');
        }
        document.querySelectorAll('.route-option-card').forEach(card => {
            card.classList.toggle('calculating', !!isPending);
            card.setAttribute('aria-busy', isPending ? 'true' : 'false');
        });
    }

    async function updateRoute(isMidDrive = false, routeOptions = {}) {
        if (!currentEnd || !currentStart) {
            pendingRouteRequestKey = null;
            verifiedRouteRequestKey = null;
            setNavigationButtonsEnabled(false);
            return;
        }

        const rerouteReason = String(routeOptions.reason || (isMidDrive ? 'off-route' : 'planning'));
        let liveRerouteCommitted = false;

        // A mid-drive request is an explicit reroute. It is the only path
        // allowed to replace the route frozen at navigation start.
        if (isMidDrive && isLiveNavActive) {
            // A GPS fix may arrive through the native provider between route
            // ticks. Always anchor a reroute to the latest accepted vehicle
            // position, never the original trip origin.
            if (lastGpsPosition && Number.isFinite(Number(lastGpsPosition.lat)) && Number.isFinite(Number(lastGpsPosition.lng))) {
                currentStart = {
                    lat: Number(lastGpsPosition.lat),
                    lng: Number(lastGpsPosition.lng),
                    accuracy: currentStart && currentStart.accuracy,
                    timestamp: lastGpsTimestamp || Date.now()
                };
            }
            // Keep the verified guidance and its remaining polyline until a
            // replacement OSRM route actually arrives. A network failure must
            // not blank the map or discard the route used by active guidance.
            if (window.DebugLogger) window.DebugLogger.log('route-reroute-start', { reason: rerouteReason });
        }

        const requestGeneration = ++routeAnalysisGeneration;
        const candidateCacheKey = getRouteCandidateCacheKey();
        const reusableCandidates = routeOptions.reuseCachedCandidates && routeData &&
            routeData.routeCandidateKey === candidateCacheKey && Array.isArray(routeData.routeCandidates)
            ? routeData.routeCandidates : null;

        // Cancel an older route request before starting a new one.  This avoids
        // a slow response overwriting a newer destination or route selection.
        if (routeAbortController) {
            routeAbortController.abort();
        }
        if (sceneRefinementAbortController) sceneRefinementAbortController.abort();
        const requestController = new AbortController();
        const sceneController = new AbortController();
        routeAbortController = requestController;
        sceneRefinementAbortController = sceneController;

        const dateObj = isRealTimeMode ? new Date() : getDateFromMinutes(selectedTimeMinutes);
        const requestKey = getCurrentRouteRequestKey(dateObj);
        pendingRouteRequestKey = requestKey;
        activeRouteRequestKey = requestKey;
        routeRefinementPending = true;
        // Keep the previously rendered route visible as context, but never
        // allow it to start navigation while a different request is pending.
        setNavigationButtonsEnabled(false);
        markRouteCalculationPending(true);
        const sunPos = updateSunInfo();

        const routeStartedAt = Date.now();
        try {
            const nextRouteData = await ShadowRouter.fetchAndAnalyzeRoutes(
                currentStart,
                currentEnd,
                dateObj,
                isTollFreeOnly,
                {
                    signal: requestController.signal,
                    // Scene enrichment has its own cancellation lifecycle.
                    // A completed OSRM route can remain usable while optional
                    // building/terrain downloads finish in the background.
                    sceneSignal: sceneController.signal,
                    // During a live reroute OSRM should start in the vehicle's
                    // current travel direction. It may still return a U-turn
                    // when that is the only connected option.
                    startHeading: isMidDrive && (hasValidGpsHeading || !!lastStableMovingGps) &&
                        Number.isFinite(Number(currentHeading)) ? currentHeading : null,
                    candidates: reusableCandidates,
                    reuseOsrmCache: true,
                    reuseSceneCache: true,
                    // Refine the role the user is actually viewing/driving
                    // before lower-value alternatives. ShadowRouter still
                    // includes the fastest baseline for same-tier comparison.
                    preferredRouteRole: currentMode,
                    onProgress: async progress => {
                        if (requestGeneration !== routeAnalysisGeneration || requestController.signal.aborted || routeAbortController !== requestController) return;
                        const progressRequestKey = getCurrentRouteRequestKey(dateObj);
                        routeData = progress;
                        routeData.calculatedAt = Date.now();
                        routeData.requestKey = progressRequestKey;
                        routeData.routeCandidateKey = candidateCacheKey;
                        routeRefinementPending = progress.enrichmentPending === true;
                        pendingRouteRequestKey = null;
                        verifiedRouteRequestKey = progressRequestKey;
                        updateRouteOptionButtons(routeData);
                        const enrichedSelection = routeData.routes[currentMode] || routeData.routes.fastest;
                        const roleKey = currentMode === 'shade' ? 'shade' : (currentMode === 'glareFree' ? 'glareFree' : 'fastest');
                        const roleMeta = routeData.roleAnalysis && routeData.roleAnalysis[roleKey];
                        const isPrecisionProgress = progress.analysisPhase === 'precision-partial' ||
                            progress.analysisPhase === 'precision-final';
                        const precisionReadyForRole = isPrecisionProgress && roleKey !== 'fastest' && roleMeta &&
                            ['scene', 'hybrid-scene'].includes(roleMeta.analysisMode) && enrichedSelection &&
                            ['scene', 'hybrid-scene'].includes(enrichedSelection.analysisMode);
                        const precisionStartsAtVehicle = precisionRouteStartsAtVehicle(enrichedSelection);
                        if (isLiveNavActive && precisionReadyForRole && !precisionStartsAtVehicle &&
                            !precisionReroutePending && Date.now() >= precisionRerouteCooldownUntil) {
                            // Scene refinement can finish after the vehicle has
                            // moved far from the original route origin. Do
                            // not swap to that stale geometry; request a fresh
                            // forward route from the current GPS position.
                            precisionReroutePending = true;
                            precisionRerouteCooldownUntil = Date.now() + PRECISION_REROUTE_COOLDOWN_MS;
                            updateRoute(true, { reason: 'precision-refresh', reuseCachedCandidates: true })
                                .catch(() => { precisionReroutePending = false; });
                            return;
                        }
                        const canSwitchActiveGuidance = isLiveNavActive && precisionReadyForRole &&
                            precisionStartsAtVehicle &&
                            (!selectedRouteObj || !['scene', 'hybrid-scene'].includes(selectedRouteObj.analysisMode) ||
                                selectedRouteObj.id !== enrichedSelection.id);
                        if (canSwitchActiveGuidance) {
                            precisionReroutePending = false;
                            selectedRouteObj = enrichedSelection;
                            navigationSessionRouteId = selectedRouteObj.id || null;
                            navigationSessionRouteGeometry = selectedRouteObj.analyzed && Array.isArray(selectedRouteObj.analyzed.coordinates)
                                ? selectedRouteObj.analyzed.coordinates.map(point => [Number(point[0]), Number(point[1])])
                                : navigationSessionRouteGeometry;
                            if (lastPrecisionSwitchRouteId !== selectedRouteObj.id) {
                                lastPrecisionSwitchRouteId = selectedRouteObj.id || null;
                                const isKo = I18n.getLanguage().startsWith('ko');
                                TTSVoice.speak(isKo
                                    ? (roleKey === 'shade' ? '건물·지형 그늘 우선 경로로 안내를 갱신합니다.' : '정밀 역광 회피 경로로 안내를 갱신합니다.')
                                    : (roleKey === 'shade' ? 'Guidance updated to the precision shade route.' : 'Guidance updated to the precision glare-free route.'), true, 'precision-route-update');
                            }
                        } else if (!isLiveNavActive || !navigationSessionRouteId || !selectedRouteObj ||
                            enrichedSelection.id === navigationSessionRouteId ||
                            (isMidDrive && progress.analysisPhase === 'heuristic-initial')) {
                            // A partial precision callback is an enrichment
                            // event, not permission to replace active guidance.
                            // Live swaps must pass precisionRouteStartsAtVehicle
                            // above; explicit reroutes may commit their first
                            // verified heuristic route through the mid-drive path.
                            selectedRouteObj = enrichedSelection;
                        }
                        if (isMidDrive && isLiveNavActive && !liveRerouteCommitted && selectedRouteObj) {
                            // Commit the new session only after the first
                            // verified OSRM result. This is the point where it
                            // is safe to remove the old remaining polyline.
                            liveRerouteCommitted = true;
                            navigationSessionRouteId = selectedRouteObj.id || null;
                            navigationSessionRouteGeometry = selectedRouteObj.analyzed && Array.isArray(selectedRouteObj.analyzed.coordinates)
                                ? selectedRouteObj.analyzed.coordinates.map(point => [Number(point[0]), Number(point[1])])
                                : null;
                            if (activeRoutePolylineGroup) activeRoutePolylineGroup.clearLayers();
                            if (dynamicRemainingPolylineGroup) dynamicRemainingPolylineGroup.clearLayers();
                            dynamicRemainingLayers = new Map();
                            dynamicRemainingRouteId = null;
                            dynamicRemainingSegmentIndex = null;
                            resetNavigationRouteProgress(selectedRouteObj);
                            if (window.DebugLogger) window.DebugLogger.log('route-reroute-committed', {
                                reason: rerouteReason, routeId: navigationSessionRouteId || 'geometry-session'
                            });
                        }
                        setNavigationButtonsEnabled(isCurrentRouteReady());
                        renderMapMarkersAndPolyline(selectedRouteObj, isMidDrive || isLiveNavActive);
                        updateSummaryBox(selectedRouteObj);
                        updateHUDWithRoute(selectedRouteObj, sunPos);
                        if (window.DebugLogger) window.DebugLogger.log('route-first-result', { elapsedMs: Date.now() - routeStartedAt, routeCount: routeData.routes.all.length });
                        if (window.DebugLogger) window.DebugLogger.log('route-progress-rendered', { elapsedMs: Date.now() - routeStartedAt });
                    }
                }
            );

            if (requestGeneration !== routeAnalysisGeneration || requestController.signal.aborted || routeAbortController !== requestController) return;
            const completedRequestKey = getCurrentRouteRequestKey(dateObj);
            routeData = nextRouteData;
            routeData.calculatedAt = Date.now();
            routeData.requestKey = completedRequestKey;
            routeData.routeCandidateKey = candidateCacheKey;
            routeCandidateCacheKey = candidateCacheKey;
            if (routeData.routes) {
                Object.values(routeData.routes).forEach(route => {
                    if (route && typeof route === 'object') route.requestKey = completedRequestKey;
                });
            }
            verifiedRouteRequestKey = completedRequestKey;
            pendingRouteRequestKey = null;
            activeRouteRequestKey = null;
            routeRefinementPending = false;
            if (window.DebugLogger) window.DebugLogger.log('route-enrichment-complete', { elapsedMs: Date.now() - routeStartedAt, routeCount: routeData.routes && routeData.routes.all ? routeData.routes.all.length : 0 });
        } catch (e) {
            if (requestGeneration !== routeAnalysisGeneration || requestController.signal.aborted || routeAbortController !== requestController) return;
            const hadPreviousRoute = !!(routeData && selectedRouteObj);
            pendingRouteRequestKey = null;
            activeRouteRequestKey = null;
            routeRefinementPending = false;
            verifiedRouteRequestKey = null;
            if (!hadPreviousRoute) {
                routeData = null;
                selectedRouteObj = null;
                clearRouteFromMap(true);
                setNavigationButtonsEnabled(false);
            } else {
                // Keep the last verified OSRM route visible, but it is tied to
                // the old start/end/mode and must not be used for this request.
                setNavigationButtonsEnabled(false);
            }
            showRouteFailureMessage(e, hadPreviousRoute);
            if (window.DebugLogger) window.DebugLogger.log('route-enrichment-failure', { message: String(e && e.message || e), keptPreviousRoute: hadPreviousRoute });
            return;
        } finally {
            if (rerouteReason === 'precision-refresh') precisionReroutePending = false;
            if (routeAbortController === requestController) {
                routeAbortController = null;
            }
            if (sceneRefinementAbortController === sceneController) {
                sceneRefinementAbortController = null;
            }
            if (requestGeneration === routeAnalysisGeneration) markRouteCalculationPending(false);
        }

        updateRouteOptionButtons(routeData);

        const enrichedSelection = routeData.routes[currentMode] || routeData.routes.glareFree;
        if (!isLiveNavActive || !navigationSessionRouteId || !selectedRouteObj || enrichedSelection.id === navigationSessionRouteId) {
            selectedRouteObj = enrichedSelection;
        }
        if (isLiveNavActive && selectedRouteObj) {
            navigationSessionRouteId = selectedRouteObj.id || null;
            navigationSessionRouteGeometry = selectedRouteObj.analyzed && Array.isArray(selectedRouteObj.analyzed.coordinates)
                ? selectedRouteObj.analyzed.coordinates.map(point => [Number(point[0]), Number(point[1])]) : navigationSessionRouteGeometry;
        }
        setNavigationButtonsEnabled(isCurrentRouteReady());

        renderMapMarkersAndPolyline(selectedRouteObj, isMidDrive || isLiveNavActive);
        updateSummaryBox(selectedRouteObj);
        updateHUDWithRoute(selectedRouteObj, sunPos);

        if (isMidDrive || isLiveNavActive) {
            if (currentStart) {
                updateVehicleMarkerPosition(currentStart.lat, currentStart.lng, currentHeading);
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
                return `+${diffMin}${isKo ? '분 우회' : 'min detour'}`;
            } else if (diffMin < 0) {
                return `${diffMin}${isKo ? '분 단축' : 'min faster'}`;
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

        const glrUvCut = Number(glr.solarExposureReductionPct ?? glr.uvReductionPct) || 0;
        const shdUvCut = Number(shd.solarExposureReductionPct ?? shd.uvReductionPct) || 0;
        const routeShadeText = route => {
            const analyzed = route && route.analyzed || {};
            const mode = route && (route.analysisMode || analyzed.analysisMode);
            if (['scene', 'hybrid-scene'].includes(mode)) {
                const confirmed = Math.round(Math.max(0, Math.min(1, Number(analyzed.confirmedShadeRatio) || 0)) * 100);
                return isKo ? `확인된 그늘 ${confirmed}%` : `Confirmed shade ${confirmed}%`;
            }
            const estimated = Math.round(Math.max(0, Math.min(1, Number(analyzed.estimatedShadeRatio ?? analyzed.avgShadeCoverage) || 0)) * 100);
            return isKo ? `추정 그늘 가능성 ${estimated}%` : `Estimated shade potential ${estimated}%`;
        };

        // 1. Fastest Route (OSRM baseline: estimated glare and solar exposure)
        document.getElementById('eta-fastest').innerText = `⏱️ ${fstMin}${isKo ? '분' : 'm'} (${fstKm}km)`;
        const fstDesc = document.getElementById('desc-fastest');
        if (fstDesc) {
            fstDesc.innerText = isKo
                ? `역광 위험 추정 ${fstGlarePct}% | 태양 노출 기준 | ${routeShadeText(fst)}`
                : `Estimated glare ${fstGlarePct}% | Solar exposure baseline | ${routeShadeText(fst)}`;
        }
        const fstTraffic = document.getElementById('traffic-fastest');
        if (fstTraffic) {
            fstTraffic.classList.remove('hidden');
            if (routeData.timeOfDayAdjustment > 1.3) {
                fstTraffic.innerText = isKo ? "시간대 보정 🟡" : "Time-adjusted 🟡";
                fstTraffic.className = "traffic-chip mod";
            } else {
                fstTraffic.innerText = isKo ? "기본 보정 🟢" : "Baseline 🟢";
                fstTraffic.className = "traffic-chip smooth";
            }
        }

        // 2. Glare-Free Route (estimated glare possibility and solar exposure)
        const glrDiffText = formatRouteDetourText(glrMin, glrKmNum, fstMin, fstKmNum);
        document.getElementById('eta-glare').innerText = `⏱️ ${glrMin}${isKo ? '분' : 'm'} (${glrKm}km)`;

        const glrDesc = document.getElementById('desc-glare');
        if (glrDesc) {
            if (glr.isNight) {
                glrDesc.innerText = `${glrDiffText} | ${isKo ? '역광 위험 추정 0% | 야간 (태양 노출 0% 🌙)' : 'Estimated glare 0% | Night (solar exposure 0% 🌙)'}`;
            } else if (glrUvCut > 0) {
                glrDesc.innerText = `${glrDiffText} | ${isKo ? `역광 위험 추정 ${glrGlarePct}% | 태양 노출 ${glrUvCut}% 감소 | ${routeShadeText(glr)} 🛡️` : `Estimated glare ${glrGlarePct}% | Solar exposure -${glrUvCut}% | ${routeShadeText(glr)} 🛡️`}`;
            } else {
                glrDesc.innerText = `${glrDiffText} | ${isKo ? `역광 위험 추정 ${glrGlarePct}% | 태양 노출 기준 | ${routeShadeText(glr)} 🛡️` : `Estimated glare ${glrGlarePct}% | Solar exposure baseline | ${routeShadeText(glr)} 🛡️`}`;
            }
        }

        // 3. Shade Route (estimated shade possibility and solar exposure)
        const shdDiffText = formatRouteDetourText(shdMin, shdKmNum, fstMin, fstKmNum);
        document.getElementById('eta-shade').innerText = `⏱️ ${shdMin}${isKo ? '분' : 'm'} (${shdKm}km)`;

        const shdDesc = document.getElementById('desc-shade');
        if (shdDesc) {
            if (shd.isNight) {
                shdDesc.innerText = `${shdDiffText} | ${isKo ? '역광 위험 추정 0% | 야간 (태양 노출 0% 🌙)' : 'Estimated glare 0% | Night (solar exposure 0% 🌙)'}`;
            } else if (shdUvCut > 0) {
                shdDesc.innerText = `${shdDiffText} | ${isKo ? `태양 노출 ${shdUvCut}% 감소 | ${routeShadeText(shd)} ☂️` : `Solar exposure -${shdUvCut}% | ${routeShadeText(shd)} ☂️`}`;
            } else {
                shdDesc.innerText = `${shdDiffText} | ${isKo ? `태양 노출 기준 | ${routeShadeText(shd)} ☂️` : `Solar exposure baseline | ${routeShadeText(shd)} ☂️`}`;
            }
        }

        // Make data provenance visible beside every route card. A route stays
        // usable when public scene services fail, but it must not look as if a
        // full building/terrain model was used in that case.
        function sceneLabel(route) {
            // A route can retain partial scene diagnostics while its final
            // ranking deliberately falls back to the common heuristic tier.
            // Read the route-level coverage first; the initial analyzed object
            // otherwise hides successfully downloaded long-route coverage.
            const coverage = route && (route.sceneCoverage || (route.analyzed && route.analyzed.sceneCoverage));
            const mode = route && (route.analysisMode || (route.analyzed && route.analyzed.analysisMode));
            if (route && route.fallbackReason === 'NIGHT_SCENE_NOT_NEEDED') {
                return isKo ? '야간 · 장면 분석 불필요' : 'Night · scene analysis not needed';
            }
            if (routeData && routeData.enrichmentPending && !['scene', 'hybrid-scene'].includes(mode)) {
                return isKo ? '휴리스틱 초기값 · 건물·지형 정밀 계산 중' : 'Heuristic first pass · scene refinement running';
            }
            if (mode === 'hybrid-scene') {
                const ratio = coverage && Number.isFinite(Number(coverage.segmentRatio))
                    ? Math.round(Number(coverage.segmentRatio) * 100) : null;
                return isKo
                    ? `부분 장면 분석${ratio === null ? '' : ` (${ratio}% 구간)`}`
                    : `Partial scene analysis${ratio === null ? '' : ` (${ratio}% of segments)`}`;
            }
            if (mode === 'scene') {
                if (coverage && coverage.buildings && coverage.terrain) return isKo ? '건물·지형 정밀 분석' : 'Building/terrain precision analysis';
                if (coverage && coverage.buildings) return isKo ? '건물 데이터 반영 · 지형 데이터 미확보' : 'Building data applied · terrain unavailable';
                if (coverage && coverage.tunnels) return isKo ? '터널 데이터만 반영' : 'Tunnel data only';
                return isKo ? '장면 데이터 반영' : 'Scene data applied';
            }
            const failureLabels = {
                SCENE_MANIFEST_TIMEOUT: isKo ? '\uc7a5\uba74 \ubaa9\ub85d \ub2e4\uc6b4\ub85c\ub4dc \uc2dc\uac04 \ucd08\uacfc' : 'scene manifest timeout',
                SCENE_MANIFEST_UNAVAILABLE: isKo ? '\uc7a5\uba74 \ubaa9\ub85d \uc5f0\uacb0 \uc2e4\ud328' : 'scene manifest unavailable',
                SCENE_MANIFEST_HTTP_ERROR: isKo ? '\uc7a5\uba74 \ubaa9\ub85d \uc11c\ubc84 \uc624\ub958' : 'scene manifest server error',
                SCENE_MANIFEST_PARSE_FAILURE: isKo ? '\uc7a5\uba74 \ubaa9\ub85d \ud30c\uc2f1 \uc2e4\ud328' : 'scene manifest parse failure',
                SCENE_PACK_DOWNLOAD_TIMEOUT: isKo ? '\uc7a5\uba74 \ud0c0\uc77c \ub2e4\uc6b4\ub85c\ub4dc \uc2dc\uac04 \ucd08\uacfc' : 'scene tile download timeout',
                SCENE_PACK_HTTP_ERROR: isKo ? '\uc7a5\uba74 \ud0c0\uc77c \uc11c\ubc84 \uc624\ub958' : 'scene tile server error',
                SCENE_PACK_CHECKSUM_FAILURE: isKo ? '\uc7a5\uba74 \ud0c0\uc77c \ubb34\uacb0\uc131 \uc624\ub958' : 'scene tile checksum failure',
                SCENE_WORKER_TIMEOUT: isKo ? '\uc7a5\uba74 \uc555\ucd95 \ud574\uc81c \uc2dc\uac04 \ucd08\uacfc' : 'scene processing timeout',
                SCENE_DECOMPRESS_FAILURE: isKo ? '\uc7a5\uba74 \uc555\ucd95 \ud574\uc81c \uc2e4\ud328' : 'scene decompression failure',
                SCENE_JSON_PARSE_FAILURE: isKo ? '\uc7a5\uba74 \ud0c0\uc77c \ud30c\uc2f1 \uc2e4\ud328' : 'scene tile parse failure',
                SCENE_TILE_MISSING: isKo ? '\ud574\ub2f9 \uad6c\uac04 \uc7a5\uba74 \ud0c0\uc77c \uc5c6\uc74c' : 'scene tile not available',
                SCENE_REFINEMENT_INCOMPLETE: isKo ? '\uc7a5\uba74 \ube44\uad50 \ub4f1\uae09 \ubd88\uc644\uc804' : 'scene comparison tier incomplete',
                SCENE_DATA_UNAVAILABLE: isKo ? '\uc7a5\uba74 \ub370\uc774\ud130 \uc0ac\uc6a9 \ubd88\uac00' : 'scene data unavailable'
            };
            const failureReason = route && route.fallbackReason;
            const coverageRatio = coverage && Number.isFinite(Number(coverage.segmentRatio))
                ? Math.round(Number(coverage.segmentRatio) * 100) : null;
            const coverageNote = coverageRatio > 0
                ? (isKo ? ` · 장면 ${coverageRatio}% 확보` : ` · ${coverageRatio}% scene coverage retained`)
                : '';
            const reason = failureReason ? ` (${failureLabels[failureReason] || failureReason})` : '';
            return isKo ? `휴리스틱 추정${reason}${coverageNote}` : `Heuristic estimate${reason}${coverageNote}`;
        }
        [[fstDesc, fst], [glrDesc, glr], [shdDesc, shd]].forEach(([element, route]) => {
            if (element) element.innerText += ` | ${sceneLabel(route)}`;
        });
    }

    function getCurrentRouteRequestKey(dateObj) {
        if (!window.RouteState || typeof window.RouteState.createRouteRequestKey !== 'function') return null;
        const timeToken = isRealTimeMode
            ? 'realtime'
            : dateObj.getTime();
        return window.RouteState.createRouteRequestKey(
            currentStart,
            currentEnd,
            currentMode,
            isTollFreeOnly,
            dateObj instanceof Date ? timeToken : NaN
        );
    }

    function isCurrentRouteReady() {
        const dateObj = isRealTimeMode ? new Date() : getDateFromMinutes(selectedTimeMinutes);
        return !!selectedRouteObj && !pendingRouteRequestKey &&
            !!window.RouteState && verifiedRouteRequestKey === getCurrentRouteRequestKey(dateObj);
    }

    function renderMapMarkersAndPolyline(selectedRouteObj, isLiveDrive = false) {
        if (!selectedRouteObj || !selectedRouteObj.analyzed || !selectedRouteObj.analyzed.coordinates) return;

        if (activeRoutePolylineGroup) {
            activeRoutePolylineGroup.clearLayers();
        } else {
            activeRoutePolylineGroup = L.featureGroup().addTo(map);
        }
        if (!dynamicRemainingPolylineGroup) dynamicRemainingPolylineGroup = L.featureGroup().addTo(map);
        dynamicRemainingPolylineGroup.clearLayers();
        dynamicRemainingLayers = new Map();
        dynamicRemainingRouteId = getRouteGeometryIdentity(selectedRouteObj);
        dynamicRemainingSegmentIndex = null;
        resetNavigationRouteProgress(selectedRouteObj);

        const endIcon = L.divIcon({
            className: 'custom-map-marker end',
            html: `<div style="background:#ff453a; color:#fff; font-weight:800; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px #ff453a; border:2px solid #fff; font-size:14px;"><i class="fa-solid fa-flag-checkered"></i></div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });

        const routedEnd = ShadowRouter.getRouteEndpoint(selectedRouteObj) || currentEnd;
        if (endMarker) map.removeLayer(endMarker);
        endMarker = L.marker([routedEnd.lat, routedEnd.lng], { icon: endIcon }).addTo(map);

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
        const useDynamicRemainingPath = isLiveDrive && isLiveNavActive;
        if (segments && !useDynamicRemainingPath) {
            segments.forEach(seg => {
                let segColor = '#0284c7';
                if (seg.glareRisk > 0.45) segColor = '#f59e0b';
                else if (seg.confirmedShade) segColor = '#7c3aed';
                else if (seg.shadeState === 'estimated-shade' && seg.shadeScore > 0.5) segColor = '#0e7490';

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
            if (compassMode !== 'north-up' || Math.abs(manualMapRotation) >= 0.1) setCompassMode('north-up');
            const allCoords = selectedRouteObj.analyzed.coordinates.map(c => [c[1], c[0]]);
            if (allCoords.length >= 2) {
                // Reserve space occupied by the destination/header and the
                // bottom route summary so both endpoints remain visible.
                map.fitBounds(L.latLngBounds(allCoords), {
                    paddingTopLeft: [48, 176],
                    paddingBottomRight: [48, 156],
                    maxZoom: PREVIEW_MAX_ZOOM,
                    animate: false
                });
            }
        }
    }

    /* CLEAR ALL MAP POLYLINES, DESTINATION MARKERS, & BANNER WHEN GUIDANCE ENDS */
    function clearRouteFromMap(keepDestination = false) {
        if (routeAbortController) {
            routeAbortController.abort();
            routeAbortController = null;
        }
        if (sceneRefinementAbortController) {
            sceneRefinementAbortController.abort();
            sceneRefinementAbortController = null;
        }
        if (activeRoutePolylineGroup) {
            activeRoutePolylineGroup.clearLayers();
        }
        if (dynamicRemainingPolylineGroup) dynamicRemainingPolylineGroup.clearLayers();
        dynamicRemainingLayers = new Map();
        dynamicRemainingRouteId = null;
        dynamicRemainingSegmentIndex = null;
        resetNavigationRouteProgress(null);
        if (endMarker) {
            map.removeLayer(endMarker);
            endMarker = null;
        }

        if (!keepDestination) {
            stopRouteSummaryCycling();
            currentEnd = null;
            destinationName = '';
            const destinationInput = document.getElementById('destination-input');
            if (destinationInput) destinationInput.value = '';
        }
        routeData = null;
        selectedRouteObj = null;
        pendingRouteRequestKey = null;
        activeRouteRequestKey = null;
        routeRefinementPending = false;
        verifiedRouteRequestKey = null;

        const isKo = I18n.getLanguage().startsWith('ko');
        const destChip = document.getElementById('bar-dest-text');
        if (destChip && !keepDestination) destChip.innerText = isKo ? "목적지를 설정하세요" : "Set Destination";

        const turnBanner = document.getElementById('mobile-turn-banner');
        if (turnBanner) turnBanner.classList.remove('active', 'hazard');

        document.getElementById('sum-time').innerText = "--:--";
        document.getElementById('sum-destination').innerText = "--";
        document.getElementById('sum-duration').innerText = "--";
        document.getElementById('sum-dist').innerText = "-- km";
        resetRouteOptionCards();
        setNavigationButtonsEnabled(false);
    }

    function resetRouteOptionCards() {
        const isKo = I18n.getLanguage().startsWith('ko');
        const defaults = {
            fastest: isKo ? 'OSRM 기준 일반 경로' : 'OSRM baseline route',
            glare: isKo ? '목적지를 설정하면 계산합니다' : 'Set a destination to calculate',
            shade: isKo ? '목적지를 설정하면 계산합니다' : 'Set a destination to calculate'
        };
        const etaPlaceholder = isKo ? '⏱️ --분' : '⏱️ --m';
        [['eta-fastest', etaPlaceholder], ['eta-glare', etaPlaceholder], ['eta-shade', etaPlaceholder]].forEach(([id, value]) => {
            const element = document.getElementById(id); if (element) element.innerText = value;
        });
        [['desc-fastest', defaults.fastest], ['desc-glare', defaults.glare], ['desc-shade', defaults.shade]].forEach(([id, value]) => {
            const element = document.getElementById(id); if (element) element.innerText = value;
        });
        const chip = document.getElementById('traffic-fastest');
        if (chip) { chip.innerText = ''; chip.classList.add('hidden'); }
        document.querySelectorAll('.mode-btn, .route-option-card').forEach(card => card.classList.remove('calculating'));
    }

    function updateSummaryBox(selectedRouteObj) {
        updateRemainingSummary(selectedRouteObj.durationSec, selectedRouteObj.distanceMeters);
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
        let requestGeneration = 0;
        let requestController = null;
        let activeIndex = -1;
        let lastAddressFallbackAt = 0;
        if (!input || !dropdown) return;
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-controls', dropdownId);
        input.setAttribute('aria-autocomplete', 'list');
        dropdown.setAttribute('role', 'listbox');

        input.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            requestGeneration += 1;
            activeIndex = -1;
            if (requestController) requestController.abort();
            const val = e.target.value;

            if (inputId === 'destination-input') {
                const btn = document.getElementById('btn-confirm-destination');
                if (btn) btn.disabled = val.trim().length === 0;
            }

            if (val.length < 2) {
                dropdown.classList.remove('active');
                return;
            }

            const generation = requestGeneration;
            debounceTimer = setTimeout(async () => {
                // Photon-only autocomplete keeps Nominatim for explicit submit
                // searches, avoiding one request per partial keystroke.
                let results = [];
                requestController = new AbortController();
                const addressQuery = val.trim();
                const canUseAddressFallback = inputId === 'destination-input' &&
                    /^\s*\d+[A-Za-z]?\s+\S+/.test(addressQuery) &&
                    addressQuery.length >= 8 && Date.now() - lastAddressFallbackAt >= 4000;
                if (canUseAddressFallback) lastAddressFallbackAt = Date.now();
                try {
                    results = await Geocoder.searchPlaces(val, currentStart, {
                        includeNominatim: false,
                        // Photon remains the fast provider.  For a complete
                        // street-address query, Geocoder performs a single
                        // Nominatim fallback so exact house numbers are not
                        // silently replaced by a similarly named road.
                        fallbackNominatim: canUseAddressFallback,
                        signal: requestController.signal
                    });
                } catch (e) {
                    if (generation !== requestGeneration || (e && e.name === 'AbortError')) return;
                    console.warn('Autocomplete search unavailable:', e);
                    dropdown.classList.remove('active');
                    return;
                }
                if (generation !== requestGeneration) return;
                dropdown.innerHTML = '';
                activeIndex = -1;
                if (!results || results.length === 0) {
                    dropdown.classList.remove('active');
                    return;
                }

                results.forEach(res => {
                    const item = document.createElement('div');
                    item.className = 'result-item';
                    item.setAttribute('role', 'option');
                    item.id = `${dropdownId}-option-${dropdown.children.length}`;
                    item.setAttribute('aria-selected', 'false');
                    const icon = document.createElement('i');
                    icon.className = 'fa-solid fa-location-dot';
                    icon.style.color = 'var(--accent-cyan)';
                    const content = document.createElement('div');
                    content.style.cssText = 'flex:1; overflow:hidden;';
                    const titleRow = document.createElement('div');
                    titleRow.style.cssText = 'font-weight:700; color:#fff; display:flex; align-items:center; justify-content:space-between; gap:6px;';
                    const title = document.createElement('span');
                    title.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                    title.textContent = res.shortTitle || res.displayName;
                    titleRow.appendChild(title);
                    if (res.distKm !== null && Number.isFinite(res.distKm)) {
                        const distTag = document.createElement('span');
                        distTag.className = 'dist-tag';
                        distTag.style.cssText = 'color:#fbbf24; font-size:11px; font-weight:700;';
                        distTag.textContent = `📍 ${res.distKm < 1 ? Math.round(res.distKm * 1000) + 'm' : res.distKm.toFixed(1) + 'km'}`;
                        titleRow.appendChild(distTag);
                    }
                    const address = document.createElement('div');
                    address.style.cssText = 'font-size:11px; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                    address.textContent = res.displayName;
                    content.append(titleRow, address);
                    item.append(icon, content);
                    item.addEventListener('click', () => {
                        input.value = res.shortTitle || res.displayName;
                        dropdown.classList.remove('active');
                        onSelect({ lat: res.lat, lng: res.lng }, res.shortTitle || res.displayName);
                    });
                    dropdown.appendChild(item);
                });

                dropdown.classList.add('active');
            }, 600);
        });

        input.addEventListener('keydown', (e) => {
            const options = Array.from(dropdown.querySelectorAll('[role="option"]'));
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!options.length) return;
                activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                options.forEach((option, index) => {
                    const active = index === activeIndex;
                    option.setAttribute('aria-selected', active ? 'true' : 'false');
                    option.classList.toggle('keyboard-active', active);
                });
                input.setAttribute('aria-activedescendant', options[activeIndex].id);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                requestGeneration += 1;
                if (requestController) requestController.abort();
                dropdown.classList.remove('active');
                input.removeAttribute('aria-activedescendant');
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (activeIndex >= 0 && options[activeIndex]) {
                    options[activeIndex].click();
                    return;
                }
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
        setSidebarOpen(false);
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

    function getRoadRuleQueryContext(lat, lng) {
        const context = { heading: currentHeading, segmentIndex: null, position: { lat, lng }, routeKey: null };
        if (selectedRouteObj && selectedRouteObj.analyzed && Array.isArray(selectedRouteObj.analyzed.coordinates)) {
            context.routeKey = selectedRouteObj.id || verifiedRouteRequestKey || null;
            const snap = ShadowRouter.snapPositionAndHeadingToRoad(lat, lng, currentHeading, selectedRouteObj.analyzed.coordinates);
            const segment = selectedRouteObj.analyzed.coordinates[snap.segmentIndex || 0];
            const nextSegment = selectedRouteObj.analyzed.coordinates[(snap.segmentIndex || 0) + 1];
            context.segmentIndex = snap.segmentIndex || 0;
            if (segment && nextSegment) {
                context.heading = ShadowRouter.calculateBearing(segment[1], segment[0], nextSegment[1], nextSegment[0]);
                context.name = selectedRouteObj.maneuvers && selectedRouteObj.maneuvers.find(m => m.name)?.name || '';
                context.ref = selectedRouteObj.maneuvers && selectedRouteObj.maneuvers.find(m => m.ref)?.ref || '';
            }
        }
        return context;
    }

    function shouldRefreshRoadRules(now, context) {
        if (!lastSpeedLimitQueryPosition) return true;
        if (window.RouteState && typeof window.RouteState.shouldRefreshRoadRules === 'function') {
            return window.RouteState.shouldRefreshRoadRules(now, {
                lastPosition: lastSpeedLimitQueryPosition,
                lastFetchAt: lastSpeedLimitFetchTime,
                lastSegment: lastSpeedLimitQuerySegment,
                lastHeading: lastSpeedLimitQueryHeading,
                lastRouteKey: lastSpeedLimitQueryRouteKey
            }, {
                lat: context.position.lat,
                lng: context.position.lng,
                segmentIndex: context.segmentIndex,
                heading: context.heading,
                routeKey: context.routeKey
            }, {
                distanceMeters: ShadowRouter.calculateDistanceMeters,
                minMoveMeters: SPEED_LIMIT_MOVE_REFRESH_METERS,
                headingDelta: SPEED_LIMIT_HEADING_REFRESH_DEGREES,
                maxAgeMs: SPEED_LIMIT_MAX_REFRESH_MS
            });
        }
        const movedMeters = ShadowRouter.calculateDistanceMeters(
            lastSpeedLimitQueryPosition.lat, lastSpeedLimitQueryPosition.lng,
            context.position.lat, context.position.lng
        );
        const headingDelta = lastSpeedLimitQueryHeading === null
            ? Infinity
            : Math.abs(((context.heading - lastSpeedLimitQueryHeading + 540) % 360) - 180);
        const segmentChanged = context.segmentIndex !== null && context.segmentIndex !== lastSpeedLimitQuerySegment;
        const ttlExpired = now - lastSpeedLimitFetchTime >= SPEED_LIMIT_MAX_REFRESH_MS;
        return ttlExpired || segmentChanged || movedMeters >= SPEED_LIMIT_MOVE_REFRESH_METERS ||
            headingDelta >= SPEED_LIMIT_HEADING_REFRESH_DEGREES;
    }

    /* COUNTRY-SPECIFIC ROAD SIGN DISPLAY (US MUTCD RECTANGULAR vs KR RED CIRCLE & US STOP SIGN) */
    async function updateSpeedLimitDisplay(lat, lng) {
        const now = Date.now();
        const roadContext = getRoadRuleQueryContext(lat, lng);
        const needsRefresh = shouldRefreshRoadRules(now, roadContext);
        const requestInFlight = speedLimitAbortController && !speedLimitAbortController.signal.aborted;
        const movedSinceQuery = lastSpeedLimitQueryPosition
            ? ShadowRouter.calculateDistanceMeters(lastSpeedLimitQueryPosition.lat, lastSpeedLimitQueryPosition.lng, lat, lng)
            : Infinity;
        const headingSinceQuery = lastSpeedLimitQueryHeading === null
            ? Infinity
            : Math.abs(((roadContext.heading - lastSpeedLimitQueryHeading + 540) % 360) - 180);
        const segmentChanged = roadContext.segmentIndex !== null && roadContext.segmentIndex !== lastSpeedLimitQuerySegment;
        const urgentContextChange = segmentChanged || movedSinceQuery >= SPEED_LIMIT_MOVE_REFRESH_METERS ||
            headingSinceQuery >= SPEED_LIMIT_HEADING_REFRESH_DEGREES ||
            roadContext.routeKey !== lastSpeedLimitQueryRouteKey;
        // Do cadence/spatial checks before touching the active request. A GPS
        // tick must not abort a valid lookup and then return due to throttle.
        if (!needsRefresh) return;
        if (requestInFlight && now - speedLimitRequestStartedAt < SPEED_LIMIT_MIN_REFRESH_MS && !urgentContextChange) return;
        if (lastSpeedLimitFetchTime && now - lastSpeedLimitFetchTime < SPEED_LIMIT_MIN_REFRESH_MS &&
            !urgentContextChange) return;

        const requestGeneration = ++speedLimitRequestGeneration;
        if (speedLimitAbortController) speedLimitAbortController.abort();
        lastSpeedLimitFetchTime = now;
        speedLimitRequestStartedAt = now;
        lastSpeedLimitQueryPosition = { lat, lng };
        lastSpeedLimitQuerySegment = roadContext.segmentIndex;
        lastSpeedLimitQueryHeading = roadContext.heading;
        lastSpeedLimitQueryRouteKey = roadContext.routeKey;
        const requestController = new AbortController();
        speedLimitAbortController = requestController;

        const badgeKr = document.getElementById('speed-limit-badge-kr');
        const badgeUs = document.getElementById('speed-limit-badge-us');
        const stopBadgeUs = document.getElementById('us-stop-sign-badge');
        const valKr = document.getElementById('limit-val-kr');
        const valUs = document.getElementById('limit-val-us');
        const unitVal = document.getElementById('speed-unit-val');

        // Reuse the reverse-geocoder ISO code for this quantized GPS cell.
        // The geocoder resolves and caches it when it is not available, while
        // avoiding reuse of a code from a different country after movement.
        const cachedCountryCode = Geocoder.getCachedCountryCode
            ? Geocoder.getCachedCountryCode(lat, lng)
            : null;
        let roadData;
        try {
            roadData = await Geocoder.fetchCurrentRoadSpeedLimitAndRules(lat, lng, {
                countryCode: cachedCountryCode || undefined,
                signal: requestController.signal,
                roadContext
            });
        } catch (error) {
            if (!requestController.signal.aborted && requestGeneration === speedLimitRequestGeneration) {
                // Do not leave a previous road's limit visible after a lookup
                // failure; an unknown limit is safer than a stale one.
                currentSpeedLimit = null;
                const staleLimit = document.getElementById('speed-limit-badge-kr');
                const staleUsLimit = document.getElementById('speed-limit-badge-us');
                if (staleLimit) staleLimit.classList.add('hidden');
                if (staleUsLimit) staleUsLimit.classList.add('hidden');
                showApiNotice(I18n.getText('roadDataUnavailable'));
            }
            return;
        } finally {
            if (speedLimitAbortController === requestController) speedLimitAbortController = null;
        }
        if (requestGeneration !== speedLimitRequestGeneration || requestController.signal.aborted) return;
        currentCountry = roadData.country;
        currentCountryCode = roadData.countryCode || cachedCountryCode || currentCountryCode;
        if (roadData.errorCode && now - lastRoadDataErrorNotice > 60000) {
            lastRoadDataErrorNotice = now;
            showApiNotice(I18n.getText('roadDataUnavailable'));
        }

        // Nearby OSM road-tunnel tag and automatic theme refresh
        if (isCurrentRoadTunnel !== !!roadData.isTunnel) {
            isCurrentRoadTunnel = !!roadData.isTunnel;
            checkAndUpdateMapTileTheme();
        }

        // Store speed limits internally in km/h; localize only the display.
        currentSpeedUnit = roadData.unit || ((currentCountry === 'US' || currentCountry === 'GB') ? 'mph' : 'km/h');
        if (unitVal) unitVal.innerText = currentSpeedUnit;

        // US STOP Sign Badge Display Control
        if (stopBadgeUs) {
            if (currentCountry === 'US' && roadData.isStopSignAhead) {
                stopBadgeUs.classList.remove('hidden');
            } else {
                stopBadgeUs.classList.add('hidden');
            }
        }

        // Country-Specific Speed Limit Sign Styling
        const normalizedLimitKmh = Number.isFinite(Number(roadData.speedLimitKmh))
            ? Number(roadData.speedLimitKmh)
            : (Number.isFinite(Number(roadData.speedLimit)) ? Number(roadData.speedLimit) : null);
        if (normalizedLimitKmh !== null && normalizedLimitKmh > 0) {
            currentSpeedLimit = normalizedLimitKmh;
            const displayLimit = currentSpeedUnit === 'mph'
                ? Math.round(normalizedLimitKmh / 1.609344)
                : Math.round(normalizedLimitKmh);

            if (currentCountry === 'US') {
                // US MUTCD Rectangular White Sign
                if (valUs) valUs.innerText = displayLimit;
                if (badgeUs) badgeUs.classList.remove('hidden');
                if (badgeKr) badgeKr.classList.add('hidden');
            } else {
                // Korea / International Red Circle Sign
                if (valKr) valKr.innerText = displayLimit;
                if (badgeKr) badgeKr.classList.remove('hidden');
                if (badgeUs) badgeUs.classList.add('hidden');
            }
        } else {
            currentSpeedLimit = null; // No speed limit data for current road
            if (badgeKr) badgeKr.classList.add('hidden');
            if (badgeUs) badgeUs.classList.add('hidden');
        }

        // Highway, toll-road and toll-booth badges from nearby OSM tags
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

    function getPositionSpeedKmh(pos) {
        const coords = pos && pos.coords;
        if (!coords) return 0;
        if (coords.speed !== null && Number.isFinite(Number(coords.speed)) && Number(coords.speed) >= 0) {
            return Number(coords.speed) * 3.6;
        }
        if (!lastGpsPosition || !lastGpsTimestamp || !Number.isFinite(Number(pos.timestamp))) return 0;
        const timeDeltaSec = (Number(pos.timestamp) - Number(lastGpsTimestamp)) / 1000;
        if (timeDeltaSec <= 0.5) return 0;
        const distMeters = ShadowRouter.calculateDistanceMeters(
            lastGpsPosition.lat,
            lastGpsPosition.lng,
            Number(coords.latitude),
            Number(coords.longitude)
        );
        const calcSpeedMps = distMeters / timeDeltaSec;
        return calcSpeedMps < 50 ? calcSpeedMps * 3.6 : 0;
    }

    function updateGpsSpeedometer(pos) {
        const speedEl = document.getElementById('speed-val');
        if (!speedEl) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const kmh = getPositionSpeedKmh(pos);
        const displaySpeed = currentSpeedUnit === 'mph' ? Math.round(kmh * 0.621371) : Math.round(kmh);
        speedEl.innerText = displaySpeed;
        updateSpeedLimitDisplay(lat, lng);
        // Speed comparison remains in km/h regardless of the display unit.
        checkSpeedingHazard(kmh);
    }

    function checkSpeedingHazard(currentSpeedKmh) {
        const warningOverlay = document.getElementById('speeding-warning-overlay');
        const isKo = I18n.getLanguage().startsWith('ko');
        const now = Date.now();
        const unitText = currentSpeedUnit;
        const displayLimit = currentSpeedLimit === null ? 0 : (currentSpeedUnit === 'mph'
            ? Math.round(currentSpeedLimit * 0.621371)
            : Math.round(currentSpeedLimit));

        // Both operands are normalized km/h. Conversion is presentation-only.
        if (currentSpeedLimit !== null && currentSpeedKmh > currentSpeedLimit) {
            if (!isSpeedingWarningActive) {
                isSpeedingWarningActive = true;
                if (warningOverlay) warningOverlay.classList.remove('hidden');
                lastSpeedingAnnounceTime = now;
                TTSVoice.speak(isKo ? `과속 위험! 제한속도 ${displayLimit}${unitText}를 초과했습니다. 속도를 줄이세요.` : `Speed warning! Speed limit is ${displayLimit} ${unitText}. Please reduce speed.`, true, 'speeding');
            } else if (now - lastSpeedingAnnounceTime > 8000) {
                lastSpeedingAnnounceTime = now;
                TTSVoice.speak(isKo ? `속도 경고! 제한속도 ${displayLimit}${unitText} 감속하세요.` : `Speed warning! Please reduce speed below ${displayLimit} ${unitText}.`, true, 'speeding');
            }
        } else if (isSpeedingWarningActive) {
            isSpeedingWarningActive = false;
            if (warningOverlay) warningOverlay.classList.add('hidden');
        }
    }

    function handleDestinationArrival(navStartTime, navStartDistanceMeters) {
        navigationSessionArrived = true;
        stopGpsWatch();
        isLiveNavActive = false;
        stopRouteSummaryCycling();
        setLiveNavigationMapMode(false);
        if (window.PipController) window.PipController.setNavigationActive(false);

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
        compassModeUserOverride = false;
        setCompassMode('north-up');
        navigationSessionRouteId = null;
        navigationSessionRouteGeometry = null;
        window.__solarlessProcessNavigationPosition = null;
        clearRouteFromMap();
        recenterMapToVehicle();
    }

    async function toggleLiveGpsNavigation() {
        const btn = document.getElementById('live-gps-nav-btn');
        const directMapBtn = document.getElementById('btn-map-start-nav');
        const isKo = I18n.getLanguage().startsWith('ko');

        if (isLiveNavActive) {
            stopGpsWatch();
            isLiveNavActive = false;
            stopRouteSummaryCycling();
            setLiveNavigationMapMode(false);
            if (window.PipController) window.PipController.setNavigationActive(false);
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
            navigationSessionArrived = true;
            navigationSessionRouteId = null;
            navigationSessionRouteGeometry = null;
            window.__solarlessProcessNavigationPosition = null;
            compassModeUserOverride = false;
            setCompassMode('north-up');
            TTSVoice.speak(isKo ? "안내를 종료합니다." : "Ending navigation guidance.");
            return;
        }

        if (!isCurrentRouteReady()) {
            // The direct/live guidance buttons can be pressed while the first
            // GPS fix is still pending. Route-start owns that wait and will
            // calculate the road route once coordinates arrive; do not show a
            // misleading “navigation disabled”/permission-style alert.
            if (currentEnd && !currentStart) {
                startNavigationFlow();
                return;
            }
            const isKo = I18n.getLanguage().startsWith('ko');
            alert(isKo
                ? '새 출발지·목적지의 실제 도로 경로 계산이 끝날 때까지 내비게이션을 시작할 수 없습니다.'
                : 'Navigation is disabled until a verified road route for the current origin and destination is ready.');
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
        ensureRouteSummaryCycling();
        setLiveNavigationMapMode(true);
        // Planning/preview stays north-up. Once a valid movement heading is
        // available, guidance switches to heading-up; manual compass changes
        // remain respected after this point.
        if (!compassModeUserOverride) {
            setCompassMode(hasValidGpsHeading ? 'heading-up' : 'north-up');
        } else {
            setCompassMode(compassMode);
        }
        if (window.PipController) {
            try {
                const nativeState = await window.PipController.setNavigationActive(true);
                if (nativeState && nativeState.locationServiceStarted === false) {
                    showApiNotice(isKo
                        ? 'Android 백그라운드 위치 서비스는 시작되지 않았습니다. 앱을 열어 둔 동안 WebView GPS로 안내합니다.'
                        : 'Android background location service did not start. Guidance will use WebView GPS while the app remains open.');
                }
            } catch (error) {
                showApiNotice(isKo
                    ? 'Android 위치 서비스 상태를 확인하지 못했습니다. 앱을 열어 둔 상태에서 안내를 계속합니다.'
                    : 'Android location service status is unavailable. Guidance will continue while the app remains open.');
            }
        }
        if (window.DebugLogger) window.DebugLogger.log('navigation-start', { pipAutoEnter: window.PipController && window.PipController.getAutoEnter ? window.PipController.getAutoEnter() : false });
        recenterMapToVehicle();

        const navStartTime = Date.now();
        const navStartDistanceMeters = selectedRouteObj ? (selectedRouteObj.distanceMeters || 0) : 0;
        navigationSessionStartedAt = navStartTime;
        navigationSessionStartDistanceMeters = navStartDistanceMeters;
        navigationSessionArrived = false;
        precisionReroutePending = false;
        precisionRerouteCooldownUntil = 0;
        navigationConsecutiveOffRouteCount = 0;
        lastPrecisionSwitchRouteId = null;
        lastProcessedNavigationTimestamp = 0;
        // Anchor GPS validation to the verified route origin. This prevents
        // the first indoor/network watch fix from teleporting guidance to a
        // nearby block before there is a prior watch sample to compare.
        lastProcessedNavigationPosition = currentStart && Number.isFinite(Number(currentStart.lat)) && Number.isFinite(Number(currentStart.lng))
            ? { lat: Number(currentStart.lat), lng: Number(currentStart.lng) }
            : null;
        lastProcessedNavigationTimestamp = Date.now();
        lastProcessedNavigationAccuracy = currentStart && Number(currentStart.accuracy) > 0
            ? Number(currentStart.accuracy)
            : 50;
        navigationSessionRouteId = selectedRouteObj && selectedRouteObj.id || null;
        navigationSessionRouteGeometry = selectedRouteObj && selectedRouteObj.analyzed && Array.isArray(selectedRouteObj.analyzed.coordinates)
            ? selectedRouteObj.analyzed.coordinates.map(point => [Number(point[0]), Number(point[1])]) : null;
        resetNavigationRouteProgress(selectedRouteObj);
        if (window.DebugLogger) window.DebugLogger.log('route-frozen-for-navigation', { routeId: navigationSessionRouteId || 'geometry-session' });
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

        setSidebarOpen(false);

        // Dynamically announce exact selected route mode ("최단 시간 경로", "눈부심 방지 역광 회피 경로", "그늘 우선 경로")
        TTSVoice.speak(getRouteAnnouncementText(currentMode, false));

        // WebView geolocation and the Android foreground service feed the same
        // navigation pipeline. The active callback below returns immediately
        // after this function so arrival, reroute, turn, speed, and hazard
        // logic cannot diverge between providers.
        function processNavigationPosition(position, source = 'web-watch') {
            if (!isLiveNavActive || navigationSessionArrived || !position || !position.coords) return true;
            const coords = position.coords;
            const lat = Number(coords.latitude);
            const lng = Number(coords.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
            const timestamp = Number(position.timestamp) > 0 ? Number(position.timestamp) : Date.now();
            const accuracy = Number(coords.accuracy);
            const ageMs = Math.max(0, Date.now() - timestamp);
            if (ageMs > 2 * 60 * 1000 || timestamp + 1000 < lastProcessedNavigationTimestamp) {
                if (window.DebugLogger) window.DebugLogger.log('gps-stale-ignored', { source, ageMs });
                return true;
            }
            const distanceFromLast = lastProcessedNavigationPosition
                ? ShadowRouter.calculateDistanceMeters(lastProcessedNavigationPosition.lat, lastProcessedNavigationPosition.lng, lat, lng)
                : Infinity;
            const incomingAccuracy = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : Infinity;
            const sameFix = distanceFromLast <= 3 && Math.abs(timestamp - lastProcessedNavigationTimestamp) <= NAVIGATION_LOCATION_DEDUPE_WINDOW_MS;
            if (sameFix) {
                const improvesAccuracy = incomingAccuracy + 0.5 < lastProcessedNavigationAccuracy;
                const sourcePriority = String(source).startsWith('native') ? 2 : 1;
                const priorSourcePriority = String(gpsLastFixSource).startsWith('native') ? 2 : 1;
                if (!improvesAccuracy && (timestamp <= lastProcessedNavigationTimestamp || sourcePriority <= priorSourcePriority)) {
                    if (window.DebugLogger) window.DebugLogger.log('gps-duplicate-ignored', { source, distanceMeters: Math.round(distanceFromLast) });
                    return true;
                }
            }
            const normalized = { coords: { ...coords, latitude: lat, longitude: lng }, timestamp };
            const rawSpeedKmh = getPositionSpeedKmh(normalized);
            const fixEvaluation = window.RouteState && typeof window.RouteState.evaluateNavigationFix === 'function'
                ? window.RouteState.evaluateNavigationFix(
                    lastProcessedNavigationPosition && {
                        ...lastProcessedNavigationPosition,
                        timestamp: lastProcessedNavigationTimestamp,
                        accuracy: lastProcessedNavigationAccuracy
                    },
                    { lat, lng, timestamp, accuracy: incomingAccuracy, reportedSpeedKmh: rawSpeedKmh },
                    ShadowRouter.calculateDistanceMeters
                )
                : { accepted: true };
            if (!fixEvaluation.accepted) {
                // Still show the receiver's uncertainty, but do not move the
                // vehicle, alter route progress, announce arrival, or reroute
                // from a low-confidence indoor/network position.
                gpsLastFixSource = source || 'web-watch';
                gpsLastFixAt = timestamp;
                updateGpsAccuracyCircle(lat, lng, accuracy);
                navigationConsecutiveOffRouteCount = 0;
                if (Date.now() - lastGpsUncertainNoticeAt > 30000) {
                    lastGpsUncertainNoticeAt = Date.now();
                    const isKoGps = I18n.getLanguage().startsWith('ko');
                    showApiNotice(isKoGps
                        ? 'GPS 정확도가 낮아 현재 위치를 안내와 재탐색에 반영하지 않았습니다. 더 정확한 신호를 기다립니다.'
                        : 'GPS accuracy is too low for guidance or rerouting. Waiting for a more reliable fix.');
                }
                if (window.DebugLogger) window.DebugLogger.log('gps-fix-rejected', {
                    source,
                    reason: fixEvaluation.reason,
                    accuracy: Number.isFinite(incomingAccuracy) ? incomingAccuracy : null,
                    distanceMeters: Number.isFinite(fixEvaluation.distanceMeters) ? Math.round(fixEvaluation.distanceMeters) : null
                });
                return true;
            }
            const hasHwHeading = Number.isFinite(Number(coords.heading)) && Number(coords.heading) >= 0;
            if (hasHwHeading) hasValidGpsHeading = true;
            if (hasHwHeading && !compassModeUserOverride && compassMode === 'north-up') setCompassMode('heading-up');
            applyGpsFix(normalized, source);
            updateGpsSpeedometer(normalized);

            let heading = currentHeading;
            if (!lastStableMovingGps) {
                lastStableMovingGps = { lat, lng };
                if (hasHwHeading) { heading = Number(coords.heading); stableGpsHeading = heading; }
            } else {
                const distMoved = ShadowRouter.calculateDistanceMeters(lastStableMovingGps.lat, lastStableMovingGps.lng, lat, lng);
                if (rawSpeedKmh < 3.5 && distMoved < 4.5) heading = stableGpsHeading || currentHeading;
                else {
                    if (hasHwHeading && rawSpeedKmh > 2.0) heading = Number(coords.heading);
                    else if (distMoved >= 3.0) heading = ShadowRouter.calculateBearing(lastStableMovingGps.lat, lastStableMovingGps.lng, lat, lng);
                    stableGpsHeading = heading;
                    lastStableMovingGps = { lat, lng };
                }
            }
            currentHeading = heading;
            lastGpsPosition = { lat, lng };
            lastGpsTimestamp = timestamp;
            lastProcessedNavigationTimestamp = timestamp;
            lastProcessedNavigationPosition = { lat, lng };
            lastProcessedNavigationAccuracy = incomingAccuracy;

            const roadDestination = getActiveRoadDestination();
            if (roadDestination) {
                const distToDest = ShadowRouter.calculateDistanceMeters(lat, lng, roadDestination.lat, roadDestination.lng);
                const routeCoords = selectedRouteObj && selectedRouteObj.analyzed && selectedRouteObj.analyzed.coordinates
                    ? selectedRouteObj.analyzed.coordinates : navigationSessionRouteGeometry;
                let nearEnd = false;
                if (routeCoords && routeCoords.length > 1) {
                    const snap = ShadowRouter.snapPositionAndHeadingToRoad(lat, lng, heading, routeCoords);
                    nearEnd = snap.segmentIndex >= Math.max(0, routeCoords.length - 3);
                }
                if (distToDest <= 55 || (nearEnd && distToDest <= 80 && rawSpeedKmh < 30)) {
                    handleDestinationArrival(navigationSessionStartedAt, navigationSessionStartDistanceMeters);
                    return true;
                }
            }
            if (selectedRouteObj && selectedRouteObj.analyzed && selectedRouteObj.analyzed.coordinates) {
                const offRouteDist = ShadowRouter.distanceToRoute(lat, lng, selectedRouteObj.analyzed.coordinates);
                const now = Date.now();
                navigationConsecutiveOffRouteCount = offRouteDist > 45 ? navigationConsecutiveOffRouteCount + 1 : 0;
                if ((navigationConsecutiveOffRouteCount >= 2 || offRouteDist > 65) && now - lastRerouteTime > 8000) {
                    lastRerouteTime = now;
                    navigationConsecutiveOffRouteCount = 0;
                    TTSVoice.speak('Off route. Recalculating from current position.', true);
                    updateRoute(true, { reason: 'off-route' });
                    return true;
                }
            }
            updateVehicleMarkerPosition(lat, lng, heading);
            const sunPos = SunCalc.getPosition(new Date(), lat, lng);
            const glareRisk = ShadowRouter.calculateSegmentGlare(currentHeading, sunPos);
            const nextManeuver = findNextManeuver(lat, lng);
            updateTurnBannerText(nextManeuver, glareRisk);
            if (nextManeuver) TTSVoice.announceTurnManeuver(nextManeuver, nextManeuver.distanceFromCar);
            if (glareRisk > 0.45) TTSVoice.announceProactiveGlareWarning(currentHeading, glareRisk);
            // Do not let the generic "continue straight" hazard message
            // overwrite a real upcoming left/right turn announcement.
            if (!nextManeuver) TTSVoice.announceNavHazard(200, currentHeading, glareRisk);
            return true;
        }
        window.__solarlessProcessNavigationPosition = processNavigationPosition;

        gpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (processNavigationPosition(pos, 'web-watch')) return;
                if (isArrived) return;

                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const rawSpeedKmh = getPositionSpeedKmh(pos);
                const hasHwHeading = (pos.coords.heading !== null && !isNaN(pos.coords.heading) && pos.coords.heading >= 0);
                if (hasHwHeading) hasValidGpsHeading = true;
                if (hasHwHeading && !compassModeUserOverride && compassMode === 'north-up') setCompassMode('heading-up');

                // CRITICAL FOR DYNAMIC ROUTING: Keep currentStart synced to vehicle's actual coordinates!
                currentStart = { lat, lng, accuracy: Number.isFinite(Number(pos.coords.accuracy)) ? Number(pos.coords.accuracy) : null };
                gpsLastFixSource = 'web-watch';
                gpsLastFixAt = Date.now();
                gpsLastError = null;
                updateGpsAccuracyCircle(lat, lng, pos.coords.accuracy);

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

                currentHeading = heading;
                lastGpsPosition = { lat, lng };
                lastGpsTimestamp = pos.timestamp;

                // 1. Destination Arrival Multi-Tier Proximity Check
                const roadDestination = getActiveRoadDestination();
                if (isLiveNavActive && roadDestination && !isArrived) {
                    const distToDest = ShadowRouter.calculateDistanceMeters(lat, lng, roadDestination.lat, roadDestination.lng);
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
                        updateRoute(true, { reason: 'off-route' });
                        return;
                    }
                }

                updateVehicleMarkerPosition(lat, lng, heading);

                // Marker rendering owns the throttled camera pan. Keeping a
                // second animated setView here queues pans on every GPS fix.

                const sunPos = SunCalc.getPosition(new Date(), lat, lng);
                const glareRisk = ShadowRouter.calculateSegmentGlare(currentHeading, sunPos);

                // GPS turn-by-turn: find next maneuver and update banner + voice
                const nextManeuver = findNextManeuver(lat, lng);
                updateTurnBannerText(nextManeuver, glareRisk);

                // Turn-by-turn voice announcement (3-tier: 300m/100m/30m)
                if (nextManeuver) {
                    TTSVoice.announceTurnManeuver(nextManeuver, nextManeuver.distanceFromCar);
                }

                if (glareRisk > 0.45) {
                    TTSVoice.announceProactiveGlareWarning(currentHeading, glareRisk);
                }

                // The turn engine owns voice prompts whenever a maneuver is
                // ahead; the generic hazard engine is only a no-maneuver
                // fallback and must not announce "straight" after "turn
                // left/right" on the same GPS fix.
                if (!nextManeuver) TTSVoice.announceNavHazard(200, currentHeading, glareRisk);
            },
            (err) => {
                gpsLastError = err && err.code;
                setGpsStatusIndicator(false, false);
                if (window.DebugLogger) window.DebugLogger.log('gps-watch-error', { code: err && err.code });
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 }
        );
    }

    const btnUseGps = document.getElementById('btn-use-gps');
    if (btnUseGps) {
        btnUseGps.addEventListener('click', () => {
            const previousStart = currentStart;
            requestUserGpsLocation(false).then(() => {
                // Preserve the old “refresh origin” behavior without making
                // the route-start flow issue a second request for the same fix.
                if (currentEnd && currentStart !== previousStart && !navigationStartPending && !pendingRouteRequestKey) {
                    updateRoute();
                }
            }).catch(() => {});
        });
    }
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
                updateRoute(true, { reason: 'manual-route-change' });
                directMapStartBtn.classList.remove('reroute-mode');
                directMapStartBtn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('mapStopNav')}`;

                const liveBtn = document.getElementById('live-gps-nav-btn');
                if (liveBtn) {
                    liveBtn.classList.remove('reroute-mode');
                    liveBtn.innerHTML = `<i class="fa-solid fa-square"></i> ${I18n.getText('liveNavStop')}`;
                }

                setSidebarOpen(false);
                TTSVoice.speak(getRouteAnnouncementText(currentMode, true));
            } else {
                toggleLiveGpsNavigation();
            }
        });
    }

    const timeSlider = document.getElementById('time-slider');
    function scheduleTimeBasedRouteAnalysis(immediate = false) {
        if (!currentEnd || !currentStart) return;
        pendingRouteRequestKey = 'time-update-pending';
        setNavigationButtonsEnabled(false);
        markRouteCalculationPending(true);
        updateSunInfo();
        if (!scheduleTimeRouteUpdate) {
            const run = () => updateRoute(false, { reuseCachedCandidates: true });
            if (window.RouteState && typeof window.RouteState.createDebouncedScheduler === 'function') {
                scheduleTimeRouteUpdate = window.RouteState.createDebouncedScheduler(run, 320);
            } else {
                let timer = null;
                const schedule = (...args) => {
                    clearTimeout(timer);
                    timer = setTimeout(() => run(...args), 320);
                };
                schedule.flush = () => { clearTimeout(timer); timer = null; run(); };
                schedule.cancel = () => { clearTimeout(timer); timer = null; };
                scheduleTimeRouteUpdate = schedule;
            }
        }
        if (immediate && typeof scheduleTimeRouteUpdate.flush === 'function') {
            const now = Date.now();
            // Browsers commonly emit pointerup followed by change. Treat that
            // pair as one commit so a drag cannot trigger two expensive passes.
            if (now - lastTimeAnalysisCommitAt >= 80) {
                lastTimeAnalysisCommitAt = now;
                scheduleTimeRouteUpdate.flush();
            }
        } else scheduleTimeRouteUpdate();
    }

    timeSlider.addEventListener('input', (e) => {
        isRealTimeMode = false;
        selectedTimeMinutes = parseInt(e.target.value, 10);
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        if (currentEnd) scheduleTimeBasedRouteAnalysis(false);
    });
    timeSlider.addEventListener('change', () => scheduleTimeBasedRouteAnalysis(true));
    timeSlider.addEventListener('pointerup', () => scheduleTimeBasedRouteAnalysis(true));

    document.getElementById('btn-now-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-now-time').classList.add('active');
        isRealTimeMode = true;
        if (currentEnd) scheduleTimeBasedRouteAnalysis(true);
    });

    document.getElementById('btn-sunrise-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-sunrise-time').classList.add('active');
        isRealTimeMode = false;
        selectedTimeMinutes = gpsSunTimes.sunriseMins;
        timeSlider.value = selectedTimeMinutes;
        if (currentEnd) scheduleTimeBasedRouteAnalysis(true);
    });

    document.getElementById('btn-noon-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-noon-time').classList.add('active');
        isRealTimeMode = false;
        selectedTimeMinutes = gpsSunTimes.noonMins;
        timeSlider.value = selectedTimeMinutes;
        if (currentEnd) scheduleTimeBasedRouteAnalysis(true);
    });

    document.getElementById('btn-sunset-time').addEventListener('click', () => {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-sunset-time').classList.add('active');
        isRealTimeMode = false;
        selectedTimeMinutes = gpsSunTimes.sunsetMins;
        timeSlider.value = selectedTimeMinutes;
        if (currentEnd) scheduleTimeBasedRouteAnalysis(true);
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
                    updateRoute(true, { reason: 'manual-route-change', reuseCachedCandidates: true });
                    setSidebarOpen(false);
                    TTSVoice.speak(getRouteAnnouncementText(currentMode, true));
                } else {
                    // User pressed CANCEL: REVERT highlight back to currently active guidance mode!
                    updateModeButtonsHighlight();
                }
            } else {
                currentMode = targetMode;
                saveRouteModePreference(currentMode);
                updateModeButtonsHighlight();
                // Switching cards while planning must not abort a running ZIP
                // download/refinement. Reuse the latest verified result and
                // let the existing background session finish normally.
                if (routeData && routeData.routes) {
                    selectedRouteObj = routeData.routes[currentMode] || routeData.routes.fastest;
                    const currentRequestKey = getCurrentRouteRequestKey(
                        isRealTimeMode ? new Date() : getDateFromMinutes(selectedTimeMinutes)
                    );
                    routeData.requestKey = currentRequestKey;
                    pendingRouteRequestKey = null;
                    if (routeRefinementPending) activeRouteRequestKey = currentRequestKey;
                    verifiedRouteRequestKey = currentRequestKey;
                    updateRouteOptionButtons(routeData);
                    renderMapMarkersAndPolyline(selectedRouteObj, false);
                    updateSummaryBox(selectedRouteObj);
                    updateHUDWithRoute(selectedRouteObj, updateSunInfo());
                    setNavigationButtonsEnabled(isCurrentRouteReady());
                } else if (currentEnd) {
                    updateRoute();
                }
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

            setSidebarOpen(false);
            TTSVoice.speak(getRouteAnnouncementText(currentMode, true));
        } else {
            toggleLiveGpsNavigation();
        }
    });

    /* GITHUB AUTOMATIC APK UPDATE CHECKER. Scene releases are not app updates. */
    let latestDetectedVersionTag = "";
    let latestDetectedReleaseUrl = "";

    async function checkGitHubLatestVersion() {
        try {
            // `/releases/latest` may point at a scene archive. Inspect a
            // bounded list and choose the newest release that actually looks
            // like an APK release instead of treating scene data as app code.
            const repoUrl = "https://api.github.com/repos/HyeokjaeKwon26/Solarless-Navi/releases?per_page=30";
            const res = await fetch(repoUrl, { cache: 'no-store' });
            if (!res.ok) return;

            const payload = await res.json();
            const versionUtils = window.SolarlessVersionUtils;
            const data = Array.isArray(payload)
                ? payload.find(release => versionUtils && versionUtils.isApkRelease(release))
                : (versionUtils && versionUtils.isApkRelease(payload) ? payload : null);
            if (!versionUtils || !data || !data.tag_name) return;

            latestDetectedVersionTag = data.tag_name;
            latestDetectedReleaseUrl = data.html_url || "https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/latest";
            let currentVersion = '0.0.0';
            const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Pip;
            if (plugin && plugin.getAppVersion) {
                const version = await plugin.getAppVersion();
                currentVersion = version && version.versionName ? version.versionName : currentVersion;
            }
            if (versionUtils.compareSemver(data.tag_name, currentVersion) > 0) showUpdateModal(data.tag_name, latestDetectedReleaseUrl);
            if (window.DebugLogger) window.DebugLogger.log('apk-update-check', { latestTag: data.tag_name, currentVersion, apkRelease: true });
        } catch (err) {
            if (window.DebugLogger) window.DebugLogger.log('apk-update-check-error', { message: String(err && err.message || err) });
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
