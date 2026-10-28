(function (root) {
    'use strict';
    let identity = null, pending = null, generation = 0, revision = 0;
    let identityPresentation = '', pendingPresentation = '';
    const nextRevision = () => (revision = Math.max(revision + 1, Date.now() * 1000));
    const plugin = () => root.Capacitor?.Plugins?.Pip;
    function sync(route) {
        if (!route || !plugin()?.setGuidanceRoute) return;
        const language = root.TTSVoice.getLanguage();
        const unitSystem = root.NavigationUnits.system();
        const muted = root.TTSVoice.isMuted();
        const presentation = JSON.stringify([language, unitSystem, muted]);
        if ((identity === route && identityPresentation === presentation) || (pending === route && pendingPresentation === presentation)) return;
        const token = ++generation;
        pending = route; pendingPresentation = presentation;
        const model = root.NavigationGuidance.model(route);
        const turns = model.maneuvers.map(m => ({ type: m.type, progressMeters: m.progressMeters,
            text: `${root.TTSVoice.getManeuverText(m.type, m.modifier)} ${root.NavigationGuidance.roadLabel(m, language.startsWith('ko'))}`.trim() }));
        plugin().setGuidanceRoute({ route: { revision: nextRevision(), coordinates: model.coordinates, turns, language, unitSystem, muted } })
            .then(() => { if (generation === token) { identity = route; identityPresentation = presentation; } }).catch(() => {}).finally(() => { if (generation === token && pending === route) pending = null; });
    }
    function clear(force = false) {
        if (!force && !identity && !pending) return;
        generation++; identity = null; pending = null;
        if (plugin()?.clearGuidanceRoute) plugin().clearGuidanceRoute({ revision: nextRevision() }).catch(() => {});
    }
    function invalidate() { generation++; identity = null; pending = null; }
    root.NativeNavigation = { sync, clear, invalidate };
})(window);
