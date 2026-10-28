(function (root) {
    'use strict';
    let map, marker, pending = null, selected, original, returnFocus, restoreSearch = false;
    const el = id => document.getElementById(id);
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
            (moved ? (ko ? '직접 조정한 지점 · 출입 가능 여부 미확인' : 'Adjusted pin · vehicle access unverified')
                : (ko ? '검색된 위치 · 차량 출입구 미확인' : 'Search location · vehicle entrance unverified'));
    }
    function show(coords, name, origin, options = {}) {
        if (pending) finish(null);
        const ko = root.I18n.getLanguage().startsWith('ko');
        original = { lat: Number(coords.lat), lng: Number(coords.lng) }; selected = { ...original };
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
        el('destination-review-modal').classList.remove('hidden');
        if (!map) {
            map = root.L.map('destination-review-map', { zoomControl: true, attributionControl: true });
            map.setView(selected, 17, { animate: false });
            root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
            marker = root.L.marker([selected.lat, selected.lng], { draggable: true, icon: root.L.divIcon({ className: 'destination-review-pin', html: '<span aria-hidden="true">📍</span>', iconSize: [36, 42], iconAnchor: [18, 38] }) }).addTo(map);
            marker.on('dragend', () => { const point = marker.getLatLng(); selected = { lat: point.lat, lng: point.lng }; updatePosition(); });
            map.on('click', event => {
                if (!marker.dragging.enabled()) return;
                selected = { lat: event.latlng.lat, lng: event.latlng.lng }; marker.setLatLng(selected); updatePosition();
            });
        }
        marker.setLatLng(selected); marker.dragging.disable();
        map.invalidateSize(); map.setView(selected, 17, { animate: false });
        updatePosition(); el('btn-review-confirm').focus();
        return new Promise(resolve => { pending = resolve; });
    }
    el('btn-review-confirm').addEventListener('click', () => finish({ ...selected, source: selected.lat !== original.lat || selected.lng !== original.lng ? 'user-pin' : 'search' }));
    el('btn-review-cancel').addEventListener('click', () => finish(null));
    el('btn-review-adjust').addEventListener('click', () => {
        const enable = !marker.dragging.enabled();
        if (enable) marker.dragging.enable(); else marker.dragging.disable();
        el('btn-review-adjust').setAttribute('aria-pressed', String(enable));
    });
    el('destination-review-modal').addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); finish(null); }
        if (event.key === 'Tab') {
            const buttons = Array.from(el('destination-review-modal').querySelectorAll('button, a[href]')).filter(node => node.getClientRects().length);
            const first = buttons[0], last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    root.DestinationReview = { show, cancel: () => finish(null), isOpen: () => !!pending };
})(window);
