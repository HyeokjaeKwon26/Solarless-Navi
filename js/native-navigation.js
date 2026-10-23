(function (root) {
    'use strict';
    let identity = null, pending = null, generation = 0, revision = 0;
    const nextRevision = () => (revision = Math.max(revision + 1, Date.now() * 1000));
    const plugin = () => root.Capacitor?.Plugins?.Pip;
    function sync(route) {
        if (!route || !plugin()?.setGuidanceRoute || identity === route || pending === route) return;
        const token = generation;
        pending = route;
        const model = root.NavigationGuidance.model(route);
        const language = root.TTSVoice.getLanguage();
        const turns = model.maneuvers.map(m => ({ type: m.type, progressMeters: m.progressMeters,
            text: `${root.TTSVoice.getManeuverText(m.type, m.modifier)} ${root.NavigationGuidance.roadLabel(m, language.startsWith('ko'))}`.trim() }));
        plugin().setGuidanceRoute({ route: { revision: nextRevision(), coordinates: model.coordinates, turns, language, muted: root.TTSVoice.isMuted() } })
            .then(() => { if (generation === token) identity = route; }).catch(() => {}).finally(() => { if (generation === token && pending === route) pending = null; });
    }
    function clear(force = false) {
        if (!force && !identity && !pending) return;
        generation++; identity = null; pending = null;
        if (plugin()?.clearGuidanceRoute) plugin().clearGuidanceRoute({ revision: nextRevision() }).catch(() => {});
    }
    function invalidate() { identity = null; }
    root.NativeNavigation = { sync, clear, invalidate };
})(window);
