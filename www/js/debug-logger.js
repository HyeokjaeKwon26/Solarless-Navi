/* Bounded diagnostic logger. Debug builds expose a collapsed menu card only. */
(function (root) {
    'use strict';
    const MAX_ENTRIES = 500;
    const MAX_PENDING = 50;
    const entries = [];
    const pending = [];
    const startedAt = Date.now();
    let enabled = false;
    let panel = null;
    let output = null;

    function maskLocation(value) {
        if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lng))) return undefined;
        return { lat: Number(Number(value.lat).toFixed(3)), lng: Number(Number(value.lng).toFixed(3)) };
    }
    function sanitize(value, key = '', depth = 0) {
        const lowerKey = String(key).toLowerCase();
        if (lowerKey.includes('password') || lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('authorization')) return undefined;
        if (value && typeof value === 'object' && (key === 'coords' || key === 'position' || key === 'location' ||
            (Object.prototype.hasOwnProperty.call(value, 'lat') && Object.prototype.hasOwnProperty.call(value, 'lng')))) return maskLocation(value);
        if (depth > 3) return '[truncated]';
        if (Array.isArray(value)) return value.slice(0, 32).map(item => sanitize(item, '', depth + 1));
        if (value && typeof value === 'object') {
            const result = {};
            Object.keys(value).slice(0, 64).forEach(childKey => {
                const child = sanitize(value[childKey], childKey, depth + 1);
                if (child !== undefined) result[childKey] = child;
            });
            return result;
        }
        if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…';
        return value;
    }
    function safeDetails(details) { return sanitize(details === undefined ? {} : details); }
    function render() {
        if (output) output.textContent = entries.map(entry => JSON.stringify(entry)).join('\n');
    }
    function appendEntry(event, details) {
        entries.push({ timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt, event: String(event), details: safeDetails(details) });
        while (entries.length > MAX_ENTRIES) entries.shift();
    }
    function log(event, details = {}) {
        if (!enabled) {
            pending.push({ event, details });
            while (pending.length > MAX_PENDING) pending.shift();
            return;
        }
        appendEntry(event, details);
        render();
    }
    function createPanel() {
        if (!enabled || !root.document || panel) return;
        panel = root.document.createElement('section');
        panel.id = 'solarless-debug-panel';
        panel.className = 'debug-diagnostic-card collapsed';
        panel.setAttribute('role', 'region');
        const header = root.document.createElement('div');
        header.className = 'debug-panel-header';
        const title = root.document.createElement('strong');
        title.textContent = 'SolarLess diagnostics';
        const toggle = root.document.createElement('button');
        toggle.type = 'button';
        toggle.dataset.debugAction = 'toggle';
        toggle.textContent = 'Expand';
        header.append(title, toggle);
        const description = root.document.createElement('span');
        description.className = 'debug-panel-hint';
        description.textContent = 'Debug build · 500-entry ring buffer';
        output = root.document.createElement('pre');
        output.id = 'solarless-debug-output';
        const actions = root.document.createElement('div');
        actions.className = 'debug-panel-actions';
        ['Clear', 'Copy/Export'].forEach(label => {
            const button = root.document.createElement('button');
            button.type = 'button';
            button.dataset.debugAction = label === 'Clear' ? 'clear' : 'copy';
            button.textContent = label;
            actions.appendChild(button);
        });
        panel.append(header, description, output, actions);
        const host = root.document.querySelector('#sidebar-panel .settings-card') || root.document.getElementById('sidebar-panel') || root.document.body;
        host.appendChild(panel);
        panel.addEventListener('click', event => {
            const action = event.target && event.target.getAttribute('data-debug-action');
            if (action === 'toggle') {
                const collapsed = panel.classList.toggle('collapsed');
                toggle.textContent = collapsed ? 'Expand' : 'Collapse';
            } else if (action === 'clear') {
                entries.length = 0;
                render();
            } else if (action === 'copy') {
                const text = entries.map(entry => JSON.stringify(entry)).join('\n');
                if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(text).catch(() => {});
            }
        });
        render();
    }
    async function init() {
        let debug = root.__SOLARLESS_DEBUG__ === true || (root.location && /localhost|127\.0\.0\.1/.test(root.location.hostname));
        const plugin = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Pip;
        if (plugin && plugin.isDebugBuild) {
            try { debug = !!(await plugin.isDebugBuild()).debug; } catch (error) { /* keep web fallback */ }
        }
        enabled = debug;
        if (enabled) {
            createPanel();
            pending.splice(0).forEach(item => appendEntry(item.event, item.details));
            render();
        } else pending.length = 0;
        log('debug-init', { enabled });
        return enabled;
    }
    root.DebugLogger = { init, log, isEnabled: () => enabled, getEntries: () => entries.slice() };
    if (typeof module === 'object' && module.exports) module.exports = root.DebugLogger;
})(typeof window !== 'undefined' ? window : globalThis);
