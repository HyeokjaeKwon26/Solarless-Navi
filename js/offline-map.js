/**
 * OfflineMap helpers.
 *
 * Map tiles may be cached after they are loaded, but route calculation still
 * requires a real road-network response from OSRM.  We intentionally do not
 * synthesize a route when the network is unavailable: a curved line is not a
 * safe navigation route and must never be used for turn-by-turn guidance.
 */

window.OfflineMap = (function () {

    // Best-effort tile cache for previously loaded tiles. This is not a
    // complete offline map service and is not used for route computation.
    const CACHE_NAME = 'solaris-map-tiles-v1';

    /**
     * Intercepts Leaflet tile requests and caches them for offline standalone use
     */
    function registerOfflineTileCache(leafletTileLayer) {
        if (!('caches' in window)) return;

        leafletTileLayer.on('tileload', (e) => {
            if (e.tile && e.tile.src) {
                caches.open(CACHE_NAME).then(cache => {
                    cache.add(e.tile.src).catch(() => {});
                });
            }
        });
    }

    /**
     * Kept as a compatibility guard for older callers.  It must never return
     * navigation data: no local road graph is bundled with this app.
     */
    function generateStandaloneRoute() {
        return null;
    }

    return {
        registerOfflineTileCache: registerOfflineTileCache,
        generateStandaloneRoute: generateStandaloneRoute,
        canCalculateRouteOffline: () => false
    };
})();
