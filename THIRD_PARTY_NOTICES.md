# Third-party notices

## MapLibre GL JS 5.24.0

`js/maplibre-gl.js` and `css/maplibre-gl.css` are locally bundled from
MapLibre GL JS 5.24.0 under the BSD 3-Clause License. The full upstream
license, including notices for incorporated components, is bundled as
[`licenses/maplibre-gl-LICENSE.txt`](licenses/maplibre-gl-LICENSE.txt).

## MapLibre GL Leaflet 0.1.4

`js/leaflet-maplibre-gl.js` is locally bundled from
`@maplibre/maplibre-gl-leaflet` 0.1.4 under the ISC License. Its license is
also bundled as
[`licenses/maplibre-gl-leaflet-LICENSE.txt`](licenses/maplibre-gl-leaflet-LICENSE.txt).

Copyright (c) MapLibre contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## OpenFreeMap, OpenMapTiles and OpenStreetMap

The primary road basemap uses OpenFreeMap-hosted OpenMapTiles vector styles
with data from OpenStreetMap. The safe raster fallback uses the OpenStreetMap
standard tile service. Attribution is displayed in the map UI. Service use is
subject to the providers' current terms and policies:

- https://openfreemap.org/terms/
- https://openmaptiles.org/
- https://operations.osmfoundation.org/policies/tiles/

## nrel-spa 2.0.2

`js/nrel-spa.js` is a browser bundle generated from `nrel-spa` 2.0.2.

MIT License

Copyright (c) 2023-2026 Aric Camarata

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## NREL Solar Position Algorithm

The core algorithm in `nrel-spa` is a JavaScript port of the Solar Position Algorithm (SPA) developed at the National Renewable Energy Laboratory by Ibrahim Reda and Afshin Andreas. The original C source files carry these terms:

Copyright (C) 2008-2011 Alliance for Sustainable Energy, LLC, All Rights Reserved

The Solar Position Algorithm ("Software") is code in development prepared by employees of the Alliance for Sustainable Energy, LLC (the "Contractor"), under Contract No. DE-AC36-08GO28308 ("Contract") with the U.S. Department of Energy (the "DOE"). The United States Government has been granted for itself and others acting on its behalf a paid-up, non-exclusive, irrevocable, worldwide license in the Software to reproduce, prepare derivative works, and perform publicly and display publicly. Beginning five (5) years after the date permission to assert copyright is obtained from the DOE, and subject to any subsequent five (5) year renewals, the United States Government is granted for itself and others acting on its behalf a paid-up, non-exclusive, irrevocable, worldwide license in the Software to reproduce, prepare derivative works, distribute copies to the public, perform publicly and display publicly, and to permit others to do so. If the Contractor ceases to make this computer software available, it may be obtained from DOE's Office of Scientific and Technical Information's Energy Science and Technology Software Center (ESTSC) at P.O. Box 1020, Oak Ridge, TN 37831-1020.

THIS SOFTWARE IS PROVIDED BY THE CONTRACTOR "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE CONTRACTOR OR THE U.S. GOVERNMENT BE LIABLE FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER, INCLUDING BUT NOT LIMITED TO CLAIMS ASSOCIATED WITH THE LOSS OF DATA OR PROFITS, WHICH MAY RESULT FROM AN ACTION IN CONTRACT, NEGLIGENCE OR OTHER TORTIOUS CLAIM THAT ARISES OUT OF OR IN CONNECTION WITH THE ACCESS, USE OR PERFORMANCE OF THIS SOFTWARE.

Reference: Reda, I., Andreas, A. (2004). "Solar Position Algorithm for Solar Radiation Applications." Solar Energy, 76(5), 577-589.

Original source: https://midcdmz.nrel.gov/spa/

## Open-Meteo Weather Forecast API

SolarLess Navi optionally requests forecast direct-normal, direct-horizontal,
diffuse and shortwave radiation plus cloud cover from Open-Meteo. Weather data
is attributed to Open-Meteo and the national weather services/models selected
by its Best Match service. Open-Meteo publishes weather data under CC BY 4.0;
API availability and commercial/non-commercial usage conditions are governed
by the provider's current terms.

- Documentation: https://open-meteo.com/en/docs
- Licence: https://open-meteo.com/en/license
- Terms: https://open-meteo.com/en/terms
- Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/
