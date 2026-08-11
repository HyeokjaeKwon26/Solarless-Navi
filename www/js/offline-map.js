/**
 * OfflineMap helpers.
 *
 * Map tiles may be cached after they are loaded, but route calculation still
 * requires a real road-network response from OSRM.  We intentionally do not
 * synthesize a route when the network is unavailable: a curved line is not a
 * safe navigation route and must never be used for turn-by-turn guidance.
 */

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
