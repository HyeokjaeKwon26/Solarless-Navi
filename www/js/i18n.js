/**
 * SOLARIS NAV - Internationalization (i18n) Language System
 * Pure English & Korean Full UI Translation Dictionary
 */

window.I18n = (function () {
    function detectDefaultLanguage() {
        const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
        if (navLang.startsWith('ko')) {
            return 'ko-KR';
        }
        return 'en-US';
    }

    let currentLang = detectDefaultLanguage();

    const translations = {
        'ko-KR': {
            docTitle: "SolarLess Navi | 햇빛을 피하는 스마트 내비게이션",
            logoTagline: "햇빛을 피하는 스마트 내비게이션",
            shadedRestBtn: "그늘 쉼터",
            searchTitle: "어디로 가시나요?",
            searchSub: "실시간 태양 위치와 그늘을 계산해 최적 경로를 안내합니다.",
            originLabel: "출발지",
            destLabel: "목적지 (필수)",
            originPlaceholder: "🎯 내 위치 (현재 GPS)",
            destPlaceholder: "장소명, 주소, 또는 건물 검색...",
            favTitle: "즐겨찾기 / 자주 가는 장소",
            recentTitle: "최근 검색한 장소",
            clearHistoryBtn: "전체 삭제",
            confirmStartBtn: "내비게이션 탐색 시작",
            addFavBtn: "즐겨찾기 추가",
            aboutTitle: "앱 정보 (About App)",
            lblAppName: "어플리케이션 이름",
            lblAppVer: "버전 정보",
            lblAppDev: "개발자 정보",
            lblAppWeb: "개발자 홈페이지",
            lblAppCert: "보안 서명",
            btnCloseAbout: "닫기",
            drawerResetTitle: "장소 재설정",
            openSearchBtn: "출발지 / 목적지 변경하기",
            driveOptionsTitle: "주행 & 화면 옵션",
            autoDarkTitle: "🕶️ 야간/터널 자동 다크모드",
            autoDarkDesc: "일몰 시각 후 및 터널 진입 시 지도 자동 어둡게",
            tollFreeTitle: "🚫 무료 도로 우선 (통행료 회피)",
            tollFreeDesc: "유료 도로 및 요금소 회피 경로 안내",
            satelliteTitle: "🛰️ 위성 사진 지도 뷰",
            satelliteDesc: "고화질 항공/위성 사진 리얼 타일 지도",
            aboutAppBtn: "ℹ️ 앱 정보 및 개발자 정보",
            timeCardTitle: "주행 시각 설정",
            timeLive: "실시간 (기본)",
            btnNowTime: "실시간 (기본)",
            sunrise: "일출",
            solarNoon: "태양 남중",
            sunset: "일몰",
            azimuthLbl: "태양 방위각 (Azimuth)",
            elevationLbl: "태양 고도 (Elevation)",
            trafficCardTitle: "실시간 교통 소요시간 비교",
            fastestTitle: "최단 시간 경로",
            glareTitle: "역광(눈부심) 회피 경로",
            shadeTitle: "그늘·구조물 우선 경로",
            fastestDesc: "일반 탐색 경로",
            glareDesc: "태양 직사광선 정면 우회",
            shadeDesc: "건물 그림자 / 터널 구간",
            badgeRec: "추천",
            hudTitle: "모바일 주행 HUD 계기판",
            meterLabel: "정면 역광(눈부심) 위험도",
            hazardAdvice: "실시간 시각 기준 태양 각도 연산 중.",
            liveNavStart: "실시간 GPS 내비 시작",
            liveNavStop: "안내 종료",
            origChip: "🎯 내 위치",
            barDestDefault: "목적지를 설정하세요",
            btnTopBarChange: "변경",
            sumTimeLbl: "소요 시간",
            sumDistLbl: "거리",
            sumGlareLbl: "역광 위험",
            sumShadeLbl: "그늘 비율",
            mapStartNav: "안내 시작",
            mapStopNav: "안내 종료",
            recenterToastTitle: "📍 내 위치로 자동 복귀",
            recenterToastSub: "3초 후 차량 위치 중심으로 자동 복귀합니다.",
            recenterNow: "지금 복귀",
            compassHeading: "주행방향",
            compassNorth: "북쪽고정",
            mapLayerSubtitle: "🗺️ 지도 레이어 하위 설정",
            rerouteConfirm: "🔄 선택하신 경로로 변경하여 재안내를 시작하시겠습니까?",
            rerouteBtn: "선택한 경로로 재안내",
            updateTitle: "🚀 최신 버전 업데이트 안내",
            updateMsg: "SolarLess Navi의 새로운 기능과 안정성이 향상된 최신 버전이 출시되었습니다.",
            updateDownloadBtn: "지금 업데이트 다운로드",
            updateLaterBtn: "나중에 하기",
            titleHome: "홈 / 출발지 검색",
            titleShadedRest: "근처 5분 그늘 쉼터/주차장 경유지 찾기",
            titleLangToggle: "언어 즉시 전환 (한국어 <-> English)",
            titleVoiceToggle: "음성 안내 켜기/끄기",
            titleGpsWarning: "GPS 신호 탐색 중 / 미연결",
            titleDrawer: "주행 설정 및 옵션 열기",
            titleDragHandle: "아래로 끌어 설정창 닫기",
            titleSpeedLimit: "제한 속도 (대한민국/국제 규격)",
            titleBatterySaver: "OLED 발열/배터리 절전 HUD 모드",
            titleCompass: "방위 모드 변경 (주행 방향 / 북쪽 정렬)",
            titleRecenterGps: "내 GPS 위치로 지도 이동",
            roadBadgeHighway: "고속도로",
            roadBadgeToll: "유료",
            roadBadgeTollbooth: "요금소",
            bannerDistPlaceholder: "--m 앞",
            titleUseGps: "내 GPS 위치로 재설정",
            arrivalTitle: "🏁 목적지 부근에 도착했습니다!",
            arrivalSub: "안전하게 목적지에 도달하여 안내를 마칩니다.",
            arrivalLblTime: "주행 시간",
            arrivalLblDist: "주행 거리",
            arrivalLblMode: "선택 경로 모드",
            arrivalLblScore: "쾌적도 보호",
            arrivalScoreComfort: "자외선/눈부심 차단 완료 ✨",
            arrivalBtnConfirm: "안내 종료 확인",
            // Turn-by-turn maneuver keys
            turnLeft: "좌회전",
            turnRight: "우회전",
            turnSlightLeft: "좌측 방향",
            turnSlightRight: "우측 방향",
            turnSharpLeft: "급좌회전",
            turnSharpRight: "급우회전",
            turnUturn: "유턴",
            turnStraight: "직진",
            turnRoundabout: "로터리",
            turnMerge: "합류",
            turnArrive: "도착",
            turnFork: "분기점",
            turnEndOfRoad: "도로 끝",
            turnAhead: "앞에서",
            turnToward: "방면으로",
            turnBannerSafe: "안전 주행 중",
            turnBannerGlare: "⚠️ 전방 역광 위험!"
        },
        'en-US': {
            docTitle: "SolarLess Navi | Smart Solar-Glare Avoidance Navigation",
            logoTagline: "Mobile Sun & Glare-Aware Navigation",
            shadedRestBtn: "Shaded Rest",
            searchTitle: "Where to go?",
            searchSub: "Calculates real-time solar glare & shade for optimal routes.",
            originLabel: "Origin",
            destLabel: "Destination (Required)",
            originPlaceholder: "🎯 My Location (Current GPS)",
            destPlaceholder: "Search place, address, or landmark...",
            favTitle: "Favorites / Saved Places",
            recentTitle: "Recent Searches",
            clearHistoryBtn: "Clear All",
            confirmStartBtn: "Start Navigation",
            addFavBtn: "Add Favorite",
            aboutTitle: "About App",
            lblAppName: "Application Name",
            lblAppVer: "Version",
            lblAppDev: "Developer",
            lblAppWeb: "Developer Website",
            lblAppCert: "Security Signature",
            btnCloseAbout: "Close",
            drawerResetTitle: "Change Location",
            openSearchBtn: "Change Origin / Destination",
            driveOptionsTitle: "Driving & Screen Options",
            autoDarkTitle: "🕶️ Auto Night/Tunnel Dark Mode",
            autoDarkDesc: "Dimmers map after sunset & inside tunnels",
            tollFreeTitle: "🚫 Avoid Toll Roads",
            tollFreeDesc: "Route around toll roads and pay gates",
            satelliteTitle: "🛰️ High-Res Satellite View",
            satelliteDesc: "High-resolution aerial satellite imagery",
            aboutAppBtn: "ℹ️ App & Developer Info",
            timeCardTitle: "Driving Time & Sun Simulation",
            timeLive: "Live (Default)",
            btnNowTime: "Live (Default)",
            sunrise: "Sunrise",
            solarNoon: "Solar Noon",
            sunset: "Sunset",
            azimuthLbl: "Sun Azimuth Angle",
            elevationLbl: "Sun Elevation Angle",
            trafficCardTitle: "Real-Time Traffic ETA Comparison",
            fastestTitle: "Fastest Route",
            glareTitle: "Glare-Free Route",
            shadeTitle: "Shade-Priority Route",
            fastestDesc: "Standard driving route",
            glareDesc: "Detours direct sunlight glare",
            shadeDesc: "Leverages building shadows & tunnels",
            badgeRec: "RECOMMENDED",
            hudTitle: "Mobile Driving HUD Dashboard",
            meterLabel: "Front Sun Glare Risk Level",
            hazardAdvice: "Calculating real-time solar elevation.",
            liveNavStart: "Start Live GPS Nav",
            liveNavStop: "Stop Navigation",
            origChip: "🎯 My Location",
            barDestDefault: "Set Destination",
            btnTopBarChange: "Change",
            sumTimeLbl: "Duration",
            sumDistLbl: "Distance",
            sumGlareLbl: "Glare Risk",
            sumShadeLbl: "Shade Ratio",
            mapStartNav: "Start Nav",
            mapStopNav: "Stop Nav",
            recenterToastTitle: "📍 Recenter Map",
            recenterToastSub: "Recentering map to vehicle in 3s.",
            recenterNow: "Recenter Now",
            compassHeading: "HEADING-UP",
            compassNorth: "NORTH-UP",
            mapLayerSubtitle: "🗺️ Map Layer Settings",
            rerouteConfirm: "🔄 Change navigation guidance to the selected route?",
            rerouteBtn: "Reroute to Selected",
            updateTitle: "🚀 New Version Available",
            updateMsg: "A new version of SolarLess Navi is available with enhanced performance and features.",
            updateDownloadBtn: "Download Update Now",
            updateLaterBtn: "Remind Me Later",
            titleHome: "Home / Search Location",
            titleShadedRest: "Find nearby shaded parking / rest spot",
            titleLangToggle: "Toggle Language (Korean <-> English)",
            titleVoiceToggle: "Turn Voice Guidance On/Off",
            titleGpsWarning: "Searching GPS signal / Disconnected",
            titleDrawer: "Open Driving Settings & Options",
            titleDragHandle: "Swipe down to close drawer",
            titleSpeedLimit: "Speed Limit (MUTCD/International Standard)",
            titleBatterySaver: "OLED Thermal & Battery Saver HUD Mode",
            titleCompass: "Toggle Compass Mode (Heading-Up / North-Up)",
            titleRecenterGps: "Recenter Map to My GPS Location",
            roadBadgeHighway: "Highway",
            roadBadgeToll: "Toll",
            roadBadgeTollbooth: "Toll Booth",
            bannerDistPlaceholder: "--m ahead",
            titleUseGps: "Reset to My GPS Location",
            arrivalTitle: "🏁 Arrived at Destination!",
            arrivalSub: "You have arrived safely. Guidance completed.",
            arrivalLblTime: "Trip Time",
            arrivalLblDist: "Distance",
            arrivalLblMode: "Selected Route",
            arrivalLblScore: "Comfort Level",
            arrivalScoreComfort: "UV & Glare Shielded ✨",
            arrivalBtnConfirm: "End Guidance",
            // Turn-by-turn maneuver keys
            turnLeft: "Turn left",
            turnRight: "Turn right",
            turnSlightLeft: "Bear left",
            turnSlightRight: "Bear right",
            turnSharpLeft: "Sharp left",
            turnSharpRight: "Sharp right",
            turnUturn: "U-turn",
            turnStraight: "Continue straight",
            turnRoundabout: "Roundabout",
            turnMerge: "Merge",
            turnArrive: "Arrive",
            turnFork: "Fork",
            turnEndOfRoad: "End of road",
            turnAhead: "ahead",
            turnToward: "onto",
            turnBannerSafe: "Safe driving",
            turnBannerGlare: "⚠️ Sun Glare Warning!"
        }
    };

    function setLanguage(lang) {
        if (translations[lang]) {
            currentLang = lang;
            applyUiLanguage();
        }
    }

    function getLanguage() {
        return currentLang;
    }

    function getText(key) {
        const dict = translations[currentLang] || translations['ko-KR'];
        return dict[key] !== undefined ? dict[key] : key;
    }

    function applyUiLanguage() {
        const dict = translations[currentLang] || translations['ko-KR'];

        if (document.title && dict.docTitle) {
            document.title = dict.docTitle;
        }

        const setElemText = (id, text) => {
            const el = document.getElementById(id);
            if (el && text !== undefined) el.innerText = text;
        };

        const setElemHtml = (id, html) => {
            const el = document.getElementById(id);
            if (el && html !== undefined) el.innerHTML = html;
        };

        const setElemTitle = (id, title) => {
            const el = document.getElementById(id);
            if (el && title !== undefined) el.title = title;
        };

        // Title Attributes
        setElemTitle('btn-header-home', dict.titleHome);
        setElemTitle('btn-find-shaded-rest', dict.titleShadedRest);
        setElemTitle('btn-toggle-lang', dict.titleLangToggle);
        setElemTitle('btn-toggle-voice', dict.titleVoiceToggle);
        setElemTitle('gps-warning-icon', dict.titleGpsWarning);
        setElemTitle('mobile-toggle-panel', dict.titleDrawer);
        setElemTitle('drawer-drag-handle', dict.titleDragHandle);
        setElemTitle('speed-limit-badge-kr', dict.titleSpeedLimit);
        setElemTitle('btn-toggle-battery-saver', dict.titleBatterySaver);
        setElemTitle('btn-toggle-compass', dict.titleCompass);
        setElemTitle('btn-recenter-gps', dict.titleRecenterGps);

        setElemText('logo-tagline-text', dict.logoTagline);
        setElemHtml('btn-find-shaded-rest', `<i class="fa-solid fa-umbrella"></i> <span>${dict.shadedRestBtn}</span>`);
        setElemText('search-modal-title', dict.searchTitle);
        setElemText('search-modal-sub', dict.searchSub);
        setElemHtml('origin-label-text', `<i class="fa-solid fa-circle-dot"></i> ${dict.originLabel}`);
        setElemHtml('dest-label-text', `<i class="fa-solid fa-location-dot"></i> ${dict.destLabel}`);
        setElemHtml('fav-title-text', `<i class="fa-solid fa-star" style="color:#fbbf24;"></i> ${dict.favTitle}`);
        setElemHtml('recent-title-text', `<i class="fa-solid fa-clock-rotate-left"></i> ${dict.recentTitle}`);
        setElemText('btn-clear-history', dict.clearHistoryBtn);
        setElemHtml('btn-confirm-destination', `<i class="fa-solid fa-route"></i> ${dict.confirmStartBtn}`);
        
        setElemText('about-title-text', dict.aboutTitle);
        setElemText('lbl-app-name', dict.lblAppName);
        setElemText('lbl-app-ver', dict.lblAppVer);
        setElemText('lbl-app-dev', dict.lblAppDev);
        setElemText('lbl-app-web', dict.lblAppWeb);
        setElemText('lbl-app-cert', dict.lblAppCert);
        setElemText('btn-close-about-modal', dict.btnCloseAbout);

        setElemHtml('drawer-reset-title', `<i class="fa-solid fa-location-arrow"></i> ${dict.drawerResetTitle}`);
        setElemHtml('btn-open-search-modal', `<i class="fa-solid fa-magnifying-glass"></i> ${dict.openSearchBtn}`);
        setElemHtml('drive-options-title', `<i class="fa-solid fa-gear"></i> ${dict.driveOptionsTitle}`);
        setElemText('auto-dark-title', dict.autoDarkTitle);
        setElemText('auto-dark-desc', dict.autoDarkDesc);
        setElemText('toll-free-title', dict.tollFreeTitle);
        setElemText('toll-free-desc', dict.tollFreeDesc);
        setElemText('satellite-title', dict.satelliteTitle);
        setElemText('satellite-desc', dict.satelliteDesc);
        setElemText('map-layer-subtitle', dict.mapLayerSubtitle);
        setElemText('btn-about-app', dict.aboutAppBtn);

        setElemHtml('time-card-title', `<i class="fa-solid fa-clock"></i> ${dict.timeCardTitle}`);
        setElemHtml('btn-now-time', `<i class="fa-solid fa-bolt"></i> ${dict.btnNowTime}`);
        setElemText('azimuth-lbl', dict.azimuthLbl);
        setElemText('elevation-lbl', dict.elevationLbl);

        setElemHtml('traffic-card-title', `<i class="fa-solid fa-route"></i> ${dict.trafficCardTitle}`);
        setElemText('fastest-title-text', dict.fastestTitle);
        setElemText('glare-title-text', dict.glareTitle);
        setElemText('shade-title-text', dict.shadeTitle);
        setElemText('desc-fastest', dict.fastestDesc);
        setElemText('desc-glare', dict.glareDesc);
        setElemText('desc-shade', dict.shadeDesc);
        setElemText('badge-rec-text', dict.badgeRec);

        setElemHtml('hud-card-title', `<i class="fa-solid fa-car-side"></i> ${dict.hudTitle}`);
        setElemText('meter-label-text', dict.meterLabel);
        setElemHtml('hazard-advice-text', `<i class="fa-solid fa-circle-info"></i> ${dict.hazardAdvice}`);
        
        setElemText('orig-chip-text', dict.origChip);
        const barDest = document.getElementById('bar-dest-text');
        if (barDest && (barDest.innerText === "목적지를 설정하세요" || barDest.innerText === "Set Destination")) {
            barDest.innerText = dict.barDestDefault;
        }
        setElemHtml('btn-top-bar-change', `<i class="fa-solid fa-magnifying-glass"></i> ${dict.btnTopBarChange}`);

        setElemText('sum-time-lbl', dict.sumTimeLbl);
        setElemText('sum-dist-lbl', dict.sumDistLbl);
        setElemText('sum-glare-lbl', dict.sumGlareLbl);
        setElemText('sum-shade-lbl', dict.sumShadeLbl);

        setElemText('recenter-toast-title', dict.recenterToastTitle);
        setElemText('recenter-toast-sub', dict.recenterToastSub);
        setElemText('recenter-now-lbl', dict.recenterNow);

        setElemText('road-badge-highway-text', dict.roadBadgeHighway);
        setElemText('road-badge-toll-text', dict.roadBadgeToll);
        setElemText('road-badge-tollbooth-text', dict.roadBadgeTollbooth);

        setElemText('shaded-rest-btn-text', dict.shadedRestBtnText);
        setElemTitle('btn-use-gps', dict.titleUseGps);

        const timeDisp = document.getElementById('time-display-text');
        if (timeDisp && (timeDisp.innerText.includes('실시간') || timeDisp.innerText.includes('Live'))) {
            timeDisp.innerText = dict.timeLive;
        }

        ['eta-fastest', 'eta-glare', 'eta-shade'].forEach(id => {
            const el = document.getElementById(id);
            if (el && el.innerText.includes('--')) el.innerText = dict.etaPlaceholder;
        });

        const bannerDist = document.getElementById('banner-dist');
        if (bannerDist && bannerDist.innerText.includes('--')) {
            bannerDist.innerText = dict.bannerDistPlaceholder;
        }

        setElemText('update-modal-title', dict.updateTitle);
        setElemText('update-info-msg', dict.updateMsg);
        setElemText('update-download-btn-text', dict.updateDownloadBtn);
        setElemText('update-later-btn-text', dict.updateLaterBtn);

        setElemText('arrival-modal-title', dict.arrivalTitle);
        setElemText('arrival-modal-sub', dict.arrivalSub);
        setElemText('arrival-lbl-time', dict.arrivalLblTime);
        setElemText('arrival-lbl-dist', dict.arrivalLblDist);
        setElemText('arrival-lbl-mode', dict.arrivalLblMode);
        setElemText('arrival-lbl-score', dict.arrivalLblScore);
        setElemText('arrival-val-score', dict.arrivalScoreComfort);
        setElemText('arrival-btn-confirm-text', dict.arrivalBtnConfirm);

        const compassTag = document.getElementById('compass-mode-tag');
        if (compassTag) {
            const isHeadingUp = document.getElementById('btn-toggle-compass')?.classList.contains('heading-up');
            compassTag.innerText = isHeadingUp ? dict.compassHeading : dict.compassNorth;
        }

        const directMapBtn = document.getElementById('btn-map-start-nav');
        if (directMapBtn) {
            const isLive = directMapBtn.classList.contains('active');
            directMapBtn.innerHTML = isLive ?
                `<i class="fa-solid fa-square"></i> ${dict.mapStopNav}` :
                `<i class="fa-solid fa-play"></i> ${dict.mapStartNav}`;
        }

        const liveNavBtn = document.getElementById('live-gps-nav-btn');
        if (liveNavBtn) {
            const isLive = liveNavBtn.classList.contains('active');
            liveNavBtn.innerHTML = isLive ?
                `<i class="fa-solid fa-square"></i> ${dict.liveNavStop}` :
                `<i class="fa-solid fa-location-arrow"></i> ${dict.liveNavStart}`;
        }

        const originInput = document.getElementById('origin-input');
        if (originInput) {
            originInput.placeholder = dict.originPlaceholder;
            if (!originInput.value || originInput.value.includes('내 위치') || originInput.value.includes('My Location')) {
                originInput.value = dict.originPlaceholder;
            }
        }

        const destInput = document.getElementById('destination-input');
        if (destInput) destInput.placeholder = dict.destPlaceholder;
    }

    return {
        setLanguage: setLanguage,
        getLanguage: getLanguage,
        getText: getText,
        applyUiLanguage: applyUiLanguage
    };
})();
