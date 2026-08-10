# US Northeast hybrid scene tiles

This manifest points to the `scene-us-northeast-hybrid-v1` GitHub Release.
The 5 km tiles contain offline OSM building/tunnel geometry and SRTM terrain
samples. The app downloads only tiles intersecting a route, stores them in its
local cache, and performs the time-dependent sun-ray calculation on the device.

The release is generated from a dated Geofabrik extract and public SRTM data.
The raw PBF, HGT files, node index, intermediate files, and ZIP assets are not
committed to Git history. Missing tiles or failed downloads fall back to the
live scene providers and then to the common heuristic tier; they never create a
fake road route.

Coverage is experimental: estimated building heights and terrain profiles are
not a measurement of UV dose, temperature, or guaranteed shade.
