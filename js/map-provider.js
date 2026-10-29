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
    const MAPLIBRE_WORKER_URL = 'js/maplibre-gl-worker.mjs';

    const ATTRIBUTION = Object.freeze({
        vector: '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        satellite: 'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    });

    function canUseVectorMap(maplibregl, leaflet) {
        if (!leaflet || typeof leaflet.maplibreGL !== 'function') return false;
        if (!maplibregl) return false;
        try {
            if(typeof maplibregl.supported==='function')return !!maplibregl.supported();
            // MapLibre 6 removed supported(). Probe WebGL2 and release this
            // temporary context; constructor/style failures still use raster.
            if(typeof maplibregl.Map!=='function'||typeof document==='undefined')return false;
            const canvas=document.createElement('canvas'),context=canvas.getContext('webgl2');
            if(!context)return false;
            context.getExtension('WEBGL_lose_context')?.loseContext();
            return true;
        } catch (_) {
            return false;
        }
    }

    function configureMapLibreRuntime(maplibregl) {
        globalThis.MapCache?.configure(maplibregl);
        if (!maplibregl || typeof maplibregl.setWorkerUrl !== 'function') return false;
        const current = typeof maplibregl.getWorkerUrl === 'function' ? maplibregl.getWorkerUrl() : '';
        if (!current) maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
        return true;
    }

    function guardVectorLayer(layer, leaflet, dark=false) {
        if (!layer || typeof layer._transitionEnd !== 'function') return layer;
        // The upstream bridge queues a frame that still reads _map after
        // onRemove. Camera/PiP changes can remove and re-add the same layer
        // before that frame runs. Cancel it and reject old renderer callbacks.
        let generation = 0, frame = null;
        const add = layer.onAdd, remove = layer.onRemove;
        layer.onAdd = function(map) {
            generation++;this._zooming=false;const result=add.call(this,map),gl=this._glMap;
            if(globalThis.NavigationMap&&gl){const apply=()=>{if(this._glMap===gl)globalThis.NavigationMap.style(gl,dark,globalThis.NavigationMap.settings(globalThis.localStorage).style);};if(gl.isStyleLoaded())apply();else gl.once('load',apply);}
            return result;
        };
        layer.onRemove = function(map) {
            generation++;
            if(frame!==null)leaflet.Util.cancelAnimFrame(frame);
            frame=null;
            return remove.call(this,map);
        };
        layer._transitionEnd = function() {
            if(frame!==null)leaflet.Util.cancelAnimFrame(frame);
            const map=this._map, gl=this._glMap, token=generation;
            if(!map||!gl)return;
            const current=()=>token===generation&&this._map===map&&this._glMap===gl;
            frame=leaflet.Util.requestAnimFrame(()=>{
                frame=null;if(!current())return;
                const zoom=map.getZoom(), center=map.getCenter();
                const offset=map.latLngToContainerPoint(map.getBounds().getNorthWest());
                this._resizeContainer();
                leaflet.DomUtil.setTransform(gl._actualCanvas,offset,1);
                gl.once('moveend',()=>{if(current())this._zoomEnd();});
                gl.jumpTo({center,zoom:zoom-1});
            },this);
        };
        return layer;
    }

    function createRoadLayers(leaflet, maplibregl) {
        if (!leaflet || typeof leaflet.tileLayer !== 'function') {
            throw new Error('Leaflet tile support is required');
        }

        configureMapLibreRuntime(maplibregl);
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
            maxCanvasSize: [4096, 4096],transformRequest:globalThis.MapCache?.transformRequest,maxTileCacheSize:48
        };
        const primary = vectorSupported ? {
            light: guardVectorLayer(leaflet.maplibreGL({
                ...sharedVectorOptions,
                style: OPENFREEMAP_STYLES.light,
            }),leaflet),
            dark: guardVectorLayer(leaflet.maplibreGL({
                ...sharedVectorOptions,
                style: OPENFREEMAP_STYLES.dark,
            }),leaflet,true)
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
        return (state.fallbackActive || !state.vectorSupported ? ATTRIBUTION.osm : ATTRIBUTION.vector)+(state.terrain?' · <a href="https://mapterhorn.com/attribution/" target="_blank" rel="noopener noreferrer">© Mapterhorn</a>':'');
    }

    return {
        OPENFREEMAP_STYLES,
        OSM_RASTER_URL,
        MAPLIBRE_WORKER_URL,
        ATTRIBUTION,
        configureMapLibreRuntime,
        canUseVectorMap,
        guardVectorLayer,
        createRoadLayers,
        layerForTheme,
        attributionFor
    };
});
