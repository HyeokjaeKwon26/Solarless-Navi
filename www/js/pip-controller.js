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
        if (!p || !p.isPipSupported) return { supported: false, allowed: false, autoEnter: getAutoEnter(), navigationActive: false, inPip: false, reason: 'WEB_RUNTIME' };
        try {
            const result = await p.isPipSupported();
            setPipClass(result && result.inPip);
            return result || { supported: false, allowed: false };
        } catch (error) { return { supported: false, allowed: false, reason: 'PLUGIN_ERROR', error }; }
    }
    async function setNavigationActive(active) {
        const p = plugin();
        if (!p || !p.setNavigationActive) return;
        return p.setNavigationActive({ active: !!active, autoEnter: getAutoEnter() });
    }
    function getAutoEnter() {
        // Opt-in used to default to off, which meant a new Android install
        // never applied auto-enter params. Only an explicit user opt-out is
        // false; the preference remains durable across app restarts.
        try { return root.localStorage.getItem(PREF) !== '0'; } catch (e) { return true; }
    }
    function setAutoEnter(value) {
        try { root.localStorage.setItem(PREF, value ? '1' : '0'); } catch (e) { /* storage may be disabled */ }
    }
    async function enter() {
        const p = plugin();
        if (!p || !p.enterPip) return false;
        try { await p.enterPip(); return true; } catch (error) {
            if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('solarless:pipdebug', { detail: { reason: String(error && error.message || 'ENTER_FAILED') } }));
            return false;
        }
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
    async function getLocationPermissionState() {
        const p = plugin();
        if (!p || !p.getLocationPermissionState) return null;
        try { return await p.getLocationPermissionState(); } catch (error) { return { state: 'unknown', error }; }
    }
    async function getLastNavigationLocation() {
        const p = plugin();
        if (!p || !p.getLastNavigationLocation) return null;
        try { return await p.getLastNavigationLocation(); } catch (error) { return { available: false, reason: 'PLUGIN_ERROR' }; }
    }
    function addListener(name, listener) {
        const p = plugin();
        if (p && p.addListener) return p.addListener(name, listener);
        return null;
    }
    function init() {
        const p = plugin();
        if (p && p.addListener) {
            p.addListener('pipModeChanged', event => setPipClass(event && event.inPip));
            p.addListener('pipDebug', event => {
                if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('solarless:pipdebug', { detail: event || {} }));
            });
        }
        return refresh();
    }
    const api = { init, refresh, setNavigationActive, getAutoEnter, setAutoEnter, enter, openSettings, update, getLocationPermissionState, getLastNavigationLocation, addListener };
    root.PipController = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
