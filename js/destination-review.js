(function (root) {
    'use strict';
    let map, marker, approach, endpoint, previewBounds, pending = null, selected, original, returnFocus, restoreSearch = false, preview = false;
    const el = id => document.getElementById(id);
    function fitApproach() {
        if (preview && previewBounds && !el('destination-review-modal').classList.contains('hidden'))
            map.fitBounds(previewBounds, {paddingTopLeft:[32,52],paddingBottomRight:[32,32],maxZoom:18,animate:false});
    }
    function finish(value) {
        el('destination-review-modal').classList.add('hidden');
        if (restoreSearch) el('start-search-modal').classList.remove('hidden');
        const resolve = pending; pending = null;
        if (returnFocus?.isConnected) returnFocus.focus();
        if (resolve) resolve(value);
    }
    function updatePosition() {
        const ko = root.I18n.getLanguage().startsWith('ko');
        const moved = selected.lat !== original.lat || selected.lng !== original.lng;
        el('destination-review-position').textContent = `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)} · ` +
            (el('destination-entrance-confirmed').checked ? (ko ? '사용자가 확인한 차량 진입점 · 도로 접근성은 현장에서 확인' : 'User-confirmed vehicle entrance · check access on site') : moved ? (ko ? '직접 조정한 지점 · 출입 가능 여부 미확인' : 'Adjusted pin · vehicle access unverified')
                : (ko ? '검색된 위치 · 차량 출입구 미확인' : 'Search location · vehicle entrance unverified'));
    }
    function show(coords, name, origin, options = {}) {
        if (pending) finish(null);
        const ko = root.I18n.getLanguage().startsWith('ko');
        original = { lat: Number(coords.lat), lng: Number(coords.lng), source: coords.source }; selected = { lat: original.lat, lng: original.lng };
        preview = !!options.route;
        previewBounds = null;
        el('destination-entrance-confirmed').checked = coords.entranceConfirmed === true;
        el('destination-save-favorite').checked = false;
        el('destination-save-favorite').parentElement.hidden = !!options.favorite;
        el('destination-access-options').hidden = preview;
        returnFocus = document.activeElement;
        restoreSearch = !el('start-search-modal').classList.contains('hidden');
        el('start-search-modal').classList.add('hidden');
        el('destination-review-title').textContent = ko ? '목적지 위치 확인' : 'Confirm destination';
        el('destination-review-address').textContent = name;
        el('destination-review-note').textContent = ko ? '번지와 도시를 확인하세요. 핀은 건물 중심일 수 있습니다. 필요한 경우 지도를 확대하고 도착점을 조정하세요.'
            : 'Check the house number and city. The pin may be a building center. Zoom in and adjust the arrival point if needed.';
        el('destination-review-distance').textContent = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
            ? (ko ? '출발지에서 직선거리 ' : 'Straight-line distance from origin: ') + root.NavigationUnits.distance(root.NavigationGuidance.model({ analyzed: { coordinates: [[origin.lng, origin.lat], [selected.lng, selected.lat]] } }).total, { long: true }) : '';
        el('btn-review-confirm').textContent = options.favorite ? (ko ? '이 위치를 즐겨찾기에 저장' : 'Save this location as favorite') : (ko ? '이 위치로 경로 찾기' : 'Find routes to this point');
        el('btn-review-cancel').textContent = ko ? '검색으로 돌아가기' : 'Back to search';
        el('btn-review-adjust').textContent = ko ? '도착점 조정' : 'Adjust arrival pin';
        el('btn-review-adjust').setAttribute('aria-pressed', 'false');
        el('destination-entrance-label').textContent = ko ? '차량 진입점 또는 주차장 입구를 직접 확인했습니다' : 'I verified this vehicle entrance or parking entrance';
        el('destination-save-label').textContent = ko ? '이 도착점을 즐겨찾기에 저장' : 'Save this arrival point as a favorite';
        el('btn-review-adjust').hidden = preview;
        el('btn-review-cancel').hidden = preview;
        el('destination-review-modal').classList.remove('hidden');
        if (!map) {
            map = root.L.map('destination-review-map', { zoomControl: true, attributionControl: true });
            map.on('resize', fitApproach);
            map.setView(selected, 17, { animate: false });
            root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
            marker = root.L.marker([selected.lat, selected.lng], { draggable: true, icon: root.L.divIcon({ className: 'destination-review-pin', html: '<span aria-hidden="true">📍</span>', iconSize: [36, 42], iconAnchor: [18, 38] }) }).addTo(map);
            marker.on('dragend', () => { const point = marker.getLatLng(); selected = { lat: point.lat, lng: point.lng }; el('destination-entrance-confirmed').checked = false; updatePosition(); });
            map.on('click', event => {
                if (!marker.dragging.enabled()) return;
                selected = { lat: event.latlng.lat, lng: event.latlng.lng }; marker.setLatLng(selected); el('destination-entrance-confirmed').checked = false; updatePosition();
            });
        }
        marker.setLatLng(selected); marker.dragging.disable();
        if (approach) { map.removeLayer(approach); approach = null; }
        if (endpoint) { map.removeLayer(endpoint); endpoint = null; }
        map.invalidateSize(); map.setView(selected, 17, { animate: false });
        if (preview) {
            const route = options.route, all = route.analyzed.coordinates, tail = [all.at(-1)];
            let length = 0;
            for (let i = all.length - 2; i >= 0 && length < 600; i--) { length += root.PublicTraffic.distance(all[i], all[i+1]); tail.unshift(all[i]); }
            approach = root.L.polyline(tail.map(p => [p[1],p[0]]), {color:'#38bdf8',weight:6}).addTo(map);
            const end = all.at(-1), gap = root.PublicTraffic.distance(end,[selected.lng,selected.lat]);
            endpoint = root.L.circleMarker([end[1],end[0]], {radius:7,color:'#fbbf24',fillOpacity:1}).addTo(map);
            previewBounds = root.L.latLngBounds([...tail.map(p => [p[1],p[0]]),[selected.lat,selected.lng]]);
            fitApproach();
            el('destination-review-title').textContent = ko ? '도착 구간 미리보기' : 'Arrival approach preview';
            el('destination-review-distance').textContent = (ko ? '경로 끝과 선택한 핀: ' : 'Route endpoint to chosen pin: ') + root.NavigationUnits.distance(gap);
            el('destination-review-note').textContent = ko ? '파랑: 마지막 주행 구간 · 노랑: 경로 끝 · 핀: 선택한 목적지. 핀까지 연결되지 않으면 출입구와 현장 표지를 확인하세요.' : 'Blue: final driving segment · yellow: route endpoint · pin: chosen destination. Check the entrance and signs if the route stops short of the pin.';
            el('btn-review-confirm').textContent = ko ? '닫기' : 'Close';
        }
        updatePosition(); el('btn-review-confirm').focus();
        return new Promise(resolve => { pending = resolve; });
    }
    el('destination-entrance-confirmed').addEventListener('change', updatePosition);
    el('btn-review-confirm').addEventListener('click', () => finish(preview ? null : { ...selected,
        entranceConfirmed: el('destination-entrance-confirmed').checked,
        saveFavorite: el('destination-save-favorite').checked,
        source: el('destination-entrance-confirmed').checked || original.source === 'user-pin' || selected.lat !== original.lat || selected.lng !== original.lng ? 'user-pin' : 'search' }));
    el('btn-review-cancel').addEventListener('click', () => finish(null));
    el('btn-review-adjust').addEventListener('click', () => {
        const enable = !marker.dragging.enabled();
        if (enable) marker.dragging.enable(); else marker.dragging.disable();
        el('btn-review-adjust').setAttribute('aria-pressed', String(enable));
    });
    el('destination-review-modal').addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); finish(null); }
        if (event.key === 'Tab') {
            const buttons = Array.from(el('destination-review-modal').querySelectorAll('button, input, a[href]')).filter(node => node.getClientRects().length);
            const first = buttons[0], last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    root.DestinationReview = { show, cancel: () => finish(null), isOpen: () => !!pending };
})(window);
