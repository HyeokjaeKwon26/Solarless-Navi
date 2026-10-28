# Guidance, destination and route quality — 1.3.9

Version: 1.3.9 / Android versionCode 13. Existing package and pinned release certificate are retained.

## Implemented scope

1. Korean instructions with English road-name segments. Road suffix expansion is limited to named road fields; `St. Louis` and `Dr. Martin Luther King Jr. Blvd.` prefixes are not blindly rewritten. Foreground native TTS, native background snapshots, community-plugin fallback and browser speech carry language metadata. Android retains audio focus across all segments and cancels the group on interruption/error. The settings preview uses Lee Street and Harvard Avenue. Missing English language data falls back to the instruction language, with a foreground notice. Background chained turns and immediate-turn timing match the foreground policy more closely.
2. Destination review shows the full returned address, straight-line distance, coordinates and a map before planning. Users can enable pin adjustment. Search, history and saved favorites use this review while stationary; active navigation retains its destination-change confirmation. Favorite registration now requires a chosen result and map confirmation, including full-address persistence. Distinct nearby businesses remain separate results, invalid coordinates are rejected, and successful search cache entries expire after five minutes. An adjusted pin preserves the router's access tail. Route-end/pin gaps above 25 m are disclosed; vehicle entrance/access remains unverified.
3. Unknown heading no longer becomes north (`Number(null) === 0`). OSRM cache keys include direction and pin intent, and live reroutes do not reuse direction-agnostic candidate snapshots. Candidate filtering removes more complex routes only when another candidate is no slower, no longer, and no worse in U-turns/short interior unnamed segments. A sole route and meaningful time/distance tradeoffs remain available. Final filtering uses available traffic durations. U-turn counts and traffic coverage are shown without implying green congestion conditions from a baseline ETA.

The browser diagnostic journal now returns transaction completion so callers that immediately reload can await durable storage. This was found during the existing recording regression test.

## Automated and service checks

- Regression coverage includes bilingual language order, road abbreviations, native snapshot metadata, cancellation between segments, partial speech failure, necessary versus dominated U-turns, unnamed detours, heading-specific caching, explicit pin preservation, coordinate validation and separate businesses.
- Browser coverage includes destination cancellation/adjustment, no route request before confirmation, favorite candidate selection, voice preview/mute, provisional GPS preview, rerouting, updater, units, recording persistence and map fallback. Both root and `www` bundles are exercised.
- Native JVM tests cover language-tagged plans, background prefixes and legacy snapshot fallback, alongside existing GPS progress/unit/update-policy tests.
- Public service smoke check on 2026-10-27: `345 Harvard Street, Brookline, MA` returned three candidates; `94 Gerry Road, Brookline, MA` returned one. Using the first origin candidate for this connectivity check, OSRM returned one route of 8,755.7 m / 705.8 seconds, 577 geometry points and zero U-turns. Router endpoints were Harvard Street and Gerry Road. This checks service connectivity and route existence, not actual traffic, entrance legality or driving suitability.
- Local release-target Node tests: 252 passed. Additional unrelated local scene-refresh tests were excluded from the release-target count.
- Native JVM tests: 19 passed; debug build passed; Android lint: zero errors, 19 existing warnings. No physical ADB device attached.
- All 53 root/`www` assets match by SHA-256. Dependency audit: zero vulnerabilities. Version 1.3.9 / code 13 passes monotonic version and certificate identity checks.
- The full local browser run found favorite-click propagation and an immediate visibility probe in the test helper; both were corrected. The other 92 scenarios passed, and all 12 affected destination/preview/recording scenarios were rerun. Exact-source CI and public APK verification are recorded below after completion.

## 실제 폰 확인 — 아직 미실시

ADB에 실제 폰이 연결되어 있지 않아 다음 항목은 자동 테스트로 대체하지 않았습니다.

| 항목 | 확인 방법 | 통과 기준 |
|---|---|---|
| 업데이트 | 기존 1.3.8에서 앱 내 업데이트 확인 → 다운로드 → Android 설치 | 1.3.9 설치 후 즐겨찾기·단위·음소거 설정 유지 |
| 혼합 언어 음성 | 한국어 선택 후 설정의 음성 미리 듣기 | Lee Street / Harvard Avenue는 영어, 나머지는 한국어로 순서대로 재생 |
| 음성 전환 간격 | 미리 듣기 및 실제 회전 안내 청취 | 문장이 잘리거나 과도한 공백·중복 없이 이어짐 |
| 음성 데이터 | 영어 음성 설치 전후, 비행기 모드에서 미리 듣기 | 설치 상태에 맞는 음성/대체 안내; 오류 시 다음 안내를 막지 않음 |
| 오디오 중단 | Bluetooth 연결, 음악 재생, 전화 수신·종료, 음소거·해제 | 이전 문장 잔여 부분이 뒤늦게 재생되지 않고 필요한 안내가 복귀 |
| 백그라운드 | 경로 안내 중 PiP 또는 화면 끄기·다시 켜기 | 중복 음성 없이 영어 도로명·한국어 지시와 연속 회전 안내 유지 |
| 지도 확인 창 | 작은 화면·큰 글꼴·가로 화면에서 주소 확인 및 핀 조정 | 주소·버튼을 읽고 누를 수 있으며 핀 조정/취소/뒤로가기 정상 |

## 실제 주행 확인 — 아직 미실시

운전 중 앱 조작과 기록 확인은 동승자가 수행합니다.

1. Harvard Street → Gerry Road 등 익숙한 노선에서 번지·도시·핀과 실제 차량 출입구를 비교합니다. 원래 검색 핀과 조정한 핀 각각의 경로 끝점을 확인합니다. 입구·통행 제한 표지를 기준으로 판단합니다.
2. 같은 출발 위치에서 서로 반대 진행 방향으로 경로를 계산하고, 합법적으로 방향을 바꾼 뒤 재탐색합니다. 이전 방향의 캐시 경로가 남지 않는지 확인합니다.
3. 유턴이 필요한 막다른길과 우회로가 있는 일반 도로를 구분해 확인합니다. 필요한 유턴 경로가 사라지지 않는지, 불필요한 유턴·짧은 진입로 우회가 줄었는지 기록합니다.
4. 저속 시내·고속 진출로·가까운 연속 회전에서 안내 시작 위치와 회전 위치를 기록합니다. 안내가 너무 늦거나 길어서 다음 회전을 가리지 않는지 확인합니다.
5. 출퇴근 시간과 비혼잡 시간에 출발 ETA/실제 도착 시간을 기록합니다. 이 버전은 광역 실시간 정체 데이터를 추가하지 않았으므로 상용 내비와 같은 ETA 정확도를 보장하지 않습니다.

## Remaining limits

The public routing/geocoding services and map data still determine available roads, address coordinates and candidate diversity. No paid API, commercial traffic feed, cloud TTS or national closure dataset was added. Filtering is a conservative heuristic over returned candidates, not a new routing engine. English voice quality, engine-specific queue behavior and actual vehicle access require the device/drive checks above.

## Published APK verification

- Source commit: `6bc6b90215c7ae8470046407e989e429bfe636d5`.
- [APK release CI](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40624103881): success. Exact-source Node 252/252 and browser 94/94 passed; Android unit tests, debug compile and lint passed before the signed release build.
- [Independent main-branch CI](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40624098483): success, including browser regressions, syntax/mirror checks and Android tests/build/lint.
- [Release](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/app-v1.3.9) / [APK](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/app-v1.3.9/SolarLessNavi-1.3.9.apk).
- Public APK: 4,393,627 bytes; SHA-256 `9f6d9576e611d3406b1612cedcd82fe27268a6c7e837311dd134770e8d9a38a3`.
- Cryptographic APK signature verifies against the existing certificate `59ea18b8ee971936d9e9780a57c4d4594b0c3b9ddbbc6318d1ba6559111f6977`; package `com.solaris.nav`, version 1.3.9 / code 13, not debuggable.
- All ten changed web assets inside the public APK match the release commit byte-for-byte. Public update manifest and checksum asset match the downloaded APK.
- Shipping updater with real public GitHub responses and simulated installed 1.3.5/1.3.6/1.3.7/1.3.8 offers 1.3.9; simulated 1.3.9 reports up to date. This does not simulate Android's installer or prove data retention on a phone.
- Additional responsive check at 320×640 and 640×320: review controls remain reachable by scrolling and at least 44 px high, including with tile requests failing. The confirmation screenshot was inspected after the opening animation completed; fixture tiles are deliberately blank.
