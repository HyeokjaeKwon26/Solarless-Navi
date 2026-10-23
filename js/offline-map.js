/** Offline road routing lives in RoadPack; no synthetic routes or bulk tile downloads. */
window.OfflineMap = (function () {

    // Do not call cache.add() after tileload: that starts a second network
    // request and the app has no service-worker read-through path. The map
    // provider/browser HTTP cache remains authoritative until a proper
    // provider-compatible tile cache is implemented.
    function registerOfflineTileCache() {
        return false;
    }

    /**
     * Kept as a compatibility guard for older callers.  It must never return
     * navigation data: callers must use the validated RoadPack router.
     */
    function generateStandaloneRoute() {
        return null;
    }

    return {
        registerOfflineTileCache: registerOfflineTileCache,
        generateStandaloneRoute: generateStandaloneRoute,
        canCalculateRouteOffline: () => !!window.RoadPack?.graph
    };
})();
