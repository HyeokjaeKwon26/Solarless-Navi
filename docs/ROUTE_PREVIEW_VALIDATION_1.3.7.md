# Route preview and color legend — 1.3.7

## Cause and changes

The route renderer returned before drawing polylines or fitting the map whenever its origin was provisional. This included GPS older than two seconds, coarse GPS, and manually selected addresses without a GPS timestamp/accuracy. Routing could succeed and populate cards while the map remained empty.

Planning now renders the computed route for these origins. A notice distinguishes a preview using a selected address from a preview awaiting current GPS verification. The reliable-origin requirement remains enforced for live guidance; the app clears provisional guidance geometry and reroutes when a reliable fix arrives.

Map fitting measures the top and bottom overlays after updating the route summary. The shared `RoutePresentation` module supplies both preview/live segment colors and the bilingual legend. The legend identifies estimates explicitly and does not imply traffic information or field-verified shade. It supports close, backdrop, Escape, and Android Back without ending guidance.

## Automated validation

- Node tests: 235 passed, including color priority and bilingual legend qualifications.
- Focused browser regressions: stale GPS, coarse GPS, and selected-address origins show actual Leaflet paths with both endpoints clear of overlays. Live guidance still hides provisional paths until a reliable GPS fix arrives. Both root and packaged `www` versions are exercised.
- Legend checks: five matching color swatches, Korean/English, 320 px portrait and 844 px landscape, focus restoration and closure without ending guidance.
- Complete browser suite: 80 passed across root and `www`. The final legend focus/back-handler checks also passed in both builds.
- Android debug build and 15 JVM tests passed (unchanged JVM tests reused valid Gradle outputs); lint reported 0 errors and 19 existing warnings.
- All 51 root/`www` assets match by SHA-256; dependency audit found 0 vulnerabilities. Version 1.3.7 / code 11 passes the monotonic-version and signing-identity checks.

## Physical-device checks remaining

1. Update from 1.3.5/1.3.6 through the app, confirm Android installation, then confirm settings and favorites remain.
2. Wait on destination entry before choosing an address; verify the complete route appears. Repeat with a manually selected origin and weak GPS reception.
3. Open the map's Colors/범례 button in portrait and landscape, scroll the legend, switch languages, and close with Android Back. Confirm guidance continues.
4. With real GPS, start guidance from a provisional origin, obtain a reliable outdoor fix, and confirm the route starts at the current location. Verify moving guidance and rerouting in a safe road test with a passenger operating the phone.

Physical-phone installation and road tests were not performed in this session.
