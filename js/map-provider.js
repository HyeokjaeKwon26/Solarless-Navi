(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MapProvider = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const OPENFREEMAP_STYLES = Object.freeze({
        light: 'https://tiles.openfreemap.org/styles/liberty',
        dark: 'https://tiles.openfreemap.org/styles/dark'
    });
    const OSM_RASTER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

    const ATTRIBUTION = Object.freeze({
        vector: '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        satellite: 'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    });

    function canUseVectorMap(maplibregl, leaflet) {
        if (!leaflet || typeof leaflet.maplibreGL !== 'function') return false;
        if (!maplibregl || typeof maplibregl.supported !== 'function') return false;
        try {
            return !!maplibregl.supported();
        } catch (_) {
            return false;
        }
    }

    function createRoadLayers(leaflet, maplibregl) {
        if (!leaflet || typeof leaflet.tileLayer !== 'function') {
            throw new Error('Leaflet tile support is required');
        }

        const fallback = {
            light: leaflet.tileLayer(OSM_RASTER_URL, {
                maxNativeZoom: 19,
                maxZoom: 20,
                className: 'osm-fallback-light'
            }),
            dark: leaflet.tileLayer(OSM_RASTER_URL, {
                maxNativeZoom: 19,
                maxZoom: 20,
                className: 'osm-fallback-dark'
            })
        };

        const vectorSupported = canUseVectorMap(maplibregl, leaflet);
        const deviceRatio = typeof globalThis !== 'undefined' && Number.isFinite(globalThis.devicePixelRatio)
            ? globalThis.devicePixelRatio : 1;
        // Heading-up mode rotates an oversized Leaflet surface so corners do
        // not clip. Cap the backing-store density to avoid allocating an
        // unnecessarily huge WebGL canvas on high-DPI phones.
        const sharedVectorOptions = {
            interactive: false,
            padding: 0.15,
            maxZoom: 20,
            pixelRatio: Math.min(1.5, Math.max(1, deviceRatio)),
            maxCanvasSize: [4096, 4096]
        };
        const primary = vectorSupported ? {
            light: leaflet.maplibreGL({
                ...sharedVectorOptions,
                style: OPENFREEMAP_STYLES.light,
            }),
            dark: leaflet.maplibreGL({
                ...sharedVectorOptions,
                style: OPENFREEMAP_STYLES.dark,
            })
        } : fallback;

        return { primary, fallback, vectorSupported };
    }

    function layerForTheme(layerSet, theme, fallbackActive) {
        if (!layerSet) return null;
        const group = fallbackActive ? layerSet.fallback : layerSet.primary;
        return theme === 'dark' ? group.dark : group.light;
    }

    function attributionFor(options) {
        const state = options || {};
        if (state.satellite) return ATTRIBUTION.satellite;
        return state.fallbackActive || !state.vectorSupported ? ATTRIBUTION.osm : ATTRIBUTION.vector;
    }

    return {
        OPENFREEMAP_STYLES,
        OSM_RASTER_URL,
        ATTRIBUTION,
        canUseVectorMap,
        createRoadLayers,
        layerForTheme,
        attributionFor
    };
});
