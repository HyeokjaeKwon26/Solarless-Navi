# Navigation units — 1.3.8

## Changes

- One presentation policy supplies speed, speed limits, route distance, remaining distance, turn/chained-turn distance, search-result distance, rest/offline-road radius labels, arrival distance and voice units. Internal route distances remain meters and overspeed operands remain km/h.
- Automatic mode follows current location: US/GB use mph and mi/ft; other/unknown countries use km/h and km/m. Geographic detection provides an immediate estimate; cached/reverse-geocoded country data can refine it. Manual metric/imperial selection persists independently of UI language.
- A speed render updates both number and label synchronously from the last raw speed sample. A delayed country correction does not require another GPS tick.
- English ETA cards and placeholders use `min` instead of `m`.
- Native route snapshots carry the resolved unit system. Presentation changes on the same route are not dropped when an earlier bridge request is pending. Shared distance fixtures check Java and JavaScript speech, including metric/imperial boundaries and Korean/English under a non-English device locale.

## Validation

- Focused browser checks passed for US, GB and KR in root and packaged `www`, including manual changes, persistence, Korean UI, speed limits, and a delayed country response with no subsequent GPS tick. Mutation-observer samples verify number/unit pairs remain consistent.
- Changing units preserves the raw remaining distance instead of resetting route progress.
- Unit tests cover distance and speed conversion, manual/automatic selection, voice output, and pending native bridge updates.
- Release-target Node tests: 239 passed.
- Complete browser suite: 88 passed across root and packaged `www`, including the new unit regressions and existing update, search, route-preview and live-guidance checks.
- Android: 16 JVM tests passed; debug build succeeded; lint reported 0 errors and 19 existing warnings. The shared speech fixture covers 13 metric/imperial cases in both languages.
- All 52 root/`www` assets match by SHA-256. Dependency audit found 0 vulnerabilities; version 1.3.8 / code 12 passes monotonic-version and signing-identity checks.

## Physical-device checks remaining

1. Update from 1.3.5–1.3.7 through the app and confirm settings/favorites remain.
2. At rest, select each unit mode; restart the app and switch UI languages. Check route cards, search distances, remaining distance, arrival summary and PiP.
3. With real GPS, verify speed and speed-limit numbers use the displayed units. Confirm an asynchronous country lookup never leaves an old numeric value beside a new unit.
4. During a safe passenger-operated road test, compare foreground and screen-off/background voice units in Korean and English. Verify continuous progress, turn timing and overspeed behavior after changing preferences.

No physical-phone installation or road test was performed in this session.
