/* Bounded diagnostic logger. It is opt-in in production and never stores full GPS coordinates. */
(function (root) {
    'use strict';
    const MAX_ENTRIES = 500;
    const entries = [];
    const startedAt = Date.now();
    let enabled = false;
    let panel = null;
    let output = null;

    function maskLocation(value) {
        if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lng))) return undefined;
        return { lat: Number(Number(value.lat).toFixed(3)), lng: Number(Number(value.lng).toFixed(3)) };
    }
    function safeDetails(details) {
        if (!details || typeof details !== 'object') return details === undefined ? undefined : String(details);
        const result = {};
        Object.keys(details).forEach(key => {
            if (key === 'coords' || key === 'position' || key === 'location') {
                const masked = maskLocation(details[key]);
                if (masked) result[key] = masked;
                return;
            }
            if (key.toLowerCase().includes('password') || key.toLowerCase().includes('token')) return;
            const value = details[key];
            if (typeof value === 'string' && value.length > 300) result[key] = value.slice(0, 300) + '…';
            else if (value !== undefined) result[key] = value;
        });
        return result;
    }
    function render() {
        if (output) output.textContent = entries.map(entry => JSON.stringify(entry)).join('\n');
    }
    function log(event, details = {}) {
        if (!enabled) return;
        entries.push({ timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt, event: String(event), details: safeDetails(details) });
        while (entries.length > MAX_ENTRIES) entries.shift();
        render();
    }
    function createPanel() {
        if (!enabled || !root.document || panel) return;
        panel = root.document.createElement('section');
        panel.id = 'solarless-debug-panel';
        panel.setAttribute('role', 'region');
        panel.innerHTML = '<div class="debug-panel-header"><strong>SolarLess debug</strong><span>500-entry ring buffer</span></div><pre id="solarless-debug-output"></pre><div class="debug-panel-actions"><button type="button" data-debug-action="clear">Clear</button><button type="button" data-debug-action="copy">Copy/Export</button></div>';
        root.document.body.appendChild(panel);
        output = panel.querySelector('#solarless-debug-output');
        panel.addEventListener('click', event => {
            const action = event.target && event.target.getAttribute('data-debug-action');
            if (action === 'clear') { entries.length = 0; render(); }
            if (action === 'copy') {
                const text = entries.map(entry => JSON.stringify(entry)).join('\n');
                if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(text).catch(() => {});
            }
        });
    }
    async function init() {
        let debug = root.__SOLARLESS_DEBUG__ === true || (root.location && /localhost|127\.0\.0\.1/.test(root.location.hostname));
        const plugin = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Pip;
        if (plugin && plugin.isDebugBuild) {
            try { debug = !!(await plugin.isDebugBuild()).debug; } catch (error) { /* keep web fallback */ }
        }
        enabled = debug;
        if (enabled) createPanel();
        log('debug-init', { enabled });
        return enabled;
    }
    root.DebugLogger = { init, log, isEnabled: () => enabled, getEntries: () => entries.slice() };
    if (typeof module === 'object' && module.exports) module.exports = root.DebugLogger;
})(typeof window !== 'undefined' ? window : globalThis);
