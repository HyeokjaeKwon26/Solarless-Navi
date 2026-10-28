(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.NavigationUnits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    const preferenceKey = 'solarless_navigation_units';
    const valid = value => ['auto', 'metric', 'imperial'].includes(value);
    let preference = 'auto', country = 'INT';
    try { const saved = root.localStorage?.getItem(preferenceKey); if (valid(saved)) preference = saved; } catch (_) { /* optional storage */ }
    const listeners = new Set();
    const system = () => preference === 'auto' ? (['US', 'GB'].includes(country) ? 'imperial' : 'metric') : preference;
    const notify = () => listeners.forEach(listener => listener());
    function setPreference(value) {
        if (!valid(value) || value === preference) return;
        preference = value;
        try { root.localStorage?.setItem(preferenceKey, value); } catch (_) { /* optional storage */ }
        notify();
    }
    function setCountry(value) {
        const previous = system();
        country = String(value || 'INT').toUpperCase();
        if (system() !== previous) notify();
    }
    const speedUnit = () => system() === 'imperial' ? 'mph' : 'km/h';
    const speed = kmh => Math.round(Math.max(0, Number(kmh) || 0) / (system() === 'imperial' ? 1.609344 : 1));
    function distance(meters, options = {}) {
        const value = Math.max(0, Number(meters) || 0);
        const imperial = (options.system || system()) === 'imperial';
        const ko = String(options.language || '').startsWith('ko');
        let amount, unit;
        if (options.long || value >= (imperial ? 160.9344 : 1000)) {
            amount = (value / (imperial ? 1609.344 : 1000)).toFixed(1);
            unit = options.speech ? (imperial ? (ko ? '마일' : 'miles') : (ko ? '킬로미터' : 'kilometers')) : (imperial ? 'mi' : 'km');
        } else {
            amount = imperial ? Math.round(value / 0.3048 / 10) * 10 : options.speech ? Math.round(value / 10) * 10 : Math.round(value);
            if (value > 0) amount = Math.max(imperial || options.speech ? 10 : 1, amount);
            unit = options.speech ? (imperial ? (ko ? '피트' : 'feet') : (ko ? '미터' : 'meters')) : (imperial ? 'ft' : 'm');
        }
        return `${amount}${options.speech && ko ? '' : ' '}${unit}`;
    }
    return { system, speedUnit, speed, distance, setCountry, setPreference, getPreference: () => preference,
        onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
});
