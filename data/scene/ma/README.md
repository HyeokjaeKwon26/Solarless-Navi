# Massachusetts precomputed scene tiles

These tiles are generated offline from a dated Geofabrik Massachusetts
OpenStreetMap extract and public SRTM elevation tiles. The app downloads only
the 5 km tile packs needed by a route, caches them locally, and performs the
time-dependent SunCalc/ray checks on the device.

The raw OSM PBF, elevation files, intermediate node index, and generated
release assets are intentionally not committed to the source history. They
are reproducible with:

```text
npm install
npm run scene:build
npm run scene:package
```

OSM data is © OpenStreetMap contributors and is subject to the ODbL. The
source date and dataset provenance are recorded in `manifest.json`. The scene
scores are experimental estimates and do not measure UV dose, temperature, or
actual shade at every point.
