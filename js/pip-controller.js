/* Optional Android Picture-in-Picture bridge. Web builds remain functional. */
(function (root) {
    'use strict';
    const PREF = 'solarless_pip_auto_enter';
    function plugin() {
        return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Pip;
    }
    function setPipClass(inPip) {
        if (root.document && root.document.body) root.document.body.classList.toggle('pip-mode', !!inPip);
        if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('solarless:pipmode', { detail: { inPip: !!inPip } }));
    }
    async function refresh() {
        const p = plugin();
        if (!p || !p.isPipSupported) return { supported: false, allowed: false };
        try {
            const result = await p.isPipSupported();
            setPipClass(result && result.inPip);
            return result || { supported: false, allowed: false };
        } catch (error) { return { supported: false, allowed: false, error }; }
    }
    async function setNavigationActive(active) {
        const p = plugin();
        if (!p || !p.setNavigationActive) return;
        return p.setNavigationActive({ active: !!active, autoEnter: getAutoEnter() });
    }
    function getAutoEnter() {
        try { return root.localStorage.getItem(PREF) === '1'; } catch (e) { return false; }
    }
    function setAutoEnter(value) {
        try { root.localStorage.setItem(PREF, value ? '1' : '0'); } catch (e) { /* storage may be disabled */ }
    }
    async function enter() {
        const p = plugin();
        if (!p || !p.enterPip) return false;
        try { await p.enterPip(); return true; } catch (error) { return false; }
    }
    async function openSettings() {
        const p = plugin();
        if (p && p.openPipSettings) return p.openPipSettings();
        return false;
    }
    async function update() {
        const p = plugin();
        if (p && p.updatePipParams) return p.updatePipParams({ autoEnter: getAutoEnter() });
    }
    function init() {
        const p = plugin();
        if (p && p.addListener) p.addListener('pipModeChanged', event => setPipClass(event && event.inPip));
        return refresh();
    }
    const api = { init, refresh, setNavigationActive, getAutoEnter, setAutoEnter, enter, openSettings, update };
    root.PipController = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
