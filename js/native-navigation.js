(function (root) {
    'use strict';
    let identity = null, pending = null, generation = 0, revision = 0;
    let identityPresentation = '', pendingPresentation = '';
    const nextRevision = () => (revision = Math.max(revision + 1, Date.now() * 1000));
    const plugin = () => root.Capacitor?.Plugins?.Pip;
    function sync(route) {
        if (!route || !plugin()?.setGuidanceRoute) return;
        try{root.ServiceHealth?.shared.check('native-guidance');}catch{return;}
        const language = root.TTSVoice.getLanguage();
        const unitSystem = root.NavigationUnits.system();
        const muted = root.TTSVoice.isMuted();
        const presentation = JSON.stringify([language, unitSystem, muted, root.RoadPack?.graph?.pack?.savedAt || 0]);
        if ((identity === route && identityPresentation === presentation) || (pending === route && pendingPresentation === presentation)) return;
        const token = ++generation;
        pending = route; pendingPresentation = presentation;
        const model = root.NavigationGuidance.model(route);
        const turns = model.maneuvers.map((m, index) => {
            const road = root.NavigationGuidance.roadLabel(m, language.startsWith('ko'));
            let action = root.TTSVoice.getManeuverText(m.type, m.modifier);
            if (m.exit && /roundabout|rotary/.test(m.type)) action += language.startsWith('ko') ? `, ${m.exit}번째 출구` : `, take exit ${m.exit}`;
            const text = road ? (language.startsWith('ko') ? `${road} 방면 ${action}입니다.` : `${action} toward ${road}.`) : action;
            const next = model.maneuvers[index + 1];
            const compact = turn => {
                const label = root.NavigationGuidance.shortRoad(turn, language.startsWith('ko'));
                const action = root.TTSVoice.getManeuverText(turn.type, turn.modifier);
                const text = label ? (language.startsWith('ko') ? `${label} 방면 ${action}입니다.` : `${action} toward ${label}.`) : action;
                return { text, segments: root.NavigationGuidance.speechSegments(text, language, [turn.name, turn.ref]) };
            };
            const following = next && next.type !== 'arrive' ? { distanceAfter: Math.max(0, next.progressMeters - m.progressMeters), ...compact(next) } : null;
            return { type: m.type, progressMeters: m.progressMeters, text, execute: /roundabout|rotary/.test(m.type) ? {text,segments:root.NavigationGuidance.speechSegments(text,language,[m.name,m.ref,m.destinations])} : compact(m),
                complex: root.NavigationGuidance.complexTurn({...m,following}), following,
                segments: root.NavigationGuidance.speechSegments(text, language, [m.name, m.ref, m.destinations]) };
        });
        plugin().setGuidanceRoute({ route: { revision: nextRevision(), coordinates: model.coordinates, turns, language, unitSystem, muted,
            nearbyRoads: root.NearbyRoads?.nativeSnapshot(root.RoadPack?.graph) || null } })
            .then(() => { if (generation === token) { identity = route; identityPresentation = presentation; root.ServiceHealth?.shared.success('native-guidance'); } })
            .catch(() => { if(generation===token)root.ServiceHealth?.shared.failure('native-guidance',0); })
            .finally(() => { if (generation === token && pending === route) pending = null; });
    }
    function clear(force = false) {
        if (!force && !identity && !pending) return;
        generation++; identity = null; pending = null;
        if (plugin()?.clearGuidanceRoute) plugin().clearGuidanceRoute({ revision: nextRevision() }).catch(() => {});
    }
    function invalidate() { generation++; identity = null; pending = null; }
    root.NativeNavigation = { sync, clear, invalidate };
})(window);
