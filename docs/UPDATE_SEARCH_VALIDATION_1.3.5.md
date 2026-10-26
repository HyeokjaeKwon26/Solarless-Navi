# 1.3.5 업데이트·주소 검색·경로 표시 검증

## 원인과 수정

- Capacitor 6.2.2의 `PluginCall.getLong`은 `Long`만 읽는다. 실제 JSON의 APK 크기 4380808과 버전 코드 8은 `Integer`이므로 기존 다운로드 코드에서 0이 됐다. `UpdateRequest.fromCall`이 실제 브리지 데이터를 숫자 형식·양의 정수·JavaScript 안전 정수 범위로 검증해 읽도록 수정했다. URL, 최대 파일 크기, SHA-256, APK 패키지·서명·상위 버전 검증은 유지한다.
- Photon 자동완성은 `94 gerry road`의 정확한 주소를 찾지 못했지만, 명시적 검색의 Nominatim은 Brookline의 94 Gerry Road를 반환했다. 자동완성 및 오류 화면에서 전체 주소 검색을 직접 실행할 수 있게 했다. 공개 Nominatim에는 키 입력마다 자동완성 요청을 보내지 않는다. 서비스 일부가 실패한 빈 응답은 주소 부재로 단정하거나 캐시하지 않는다.
- 동일 경로 카드는 최단시간 경로를 표시 중이며 탐색 후보가 목적별 감소 효과·우회시간 기준을 충족하지 못했음을 설명한다. 경로 선택 기준 자체는 변경하지 않았다.

## 재현 근거

2026-10-26 조사에서 345 Harvard Street의 학교 대표 좌표(42.3449239, -71.1236747)에서 Brookline 94 Gerry Road(42.3006881, -71.1570098)까지 공개 OSRM의 기본 경로는 8.93 km / 12.4분이었다. 앱의 우회 후보 두 개는 10.39 km / 17.3분, 8.44 km / 14.5분이었다. 기기의 정확한 GPS가 아닌 주소 대표 좌표이며 실시간 교통 소요시간이 아니다.

같은 날 14:59 EDT, 기기의 날씨·건물 캐시가 없는 조건으로 실제 선택 알고리즘을 재실행하면 세 목적 모두 기본 경로를 선택한다. 이는 모든 도로의 최적 경로를 증명하지 않는다.

## 검증 범위

- 실제 Capacitor `PluginCall`과 JSON 파서를 사용하는 JVM 회귀 테스트: 기존 Integer→0 증상 재현, 수정된 다운로드 입력 게이트 통과, Long·정수형 수치 허용, 누락·문자열·소수·음수·초과값 및 잘못된 URL/해시 거부.
- Node 테스트: 정확한 주소 필터와 거리 정렬, 검색 부분 장애 후 재시도, 빈 결과 재검색, 기존 탐색·업데이트 정책.
- root/www 브라우저 테스트: 주소 검색 버튼 → Brookline/Lynnfield 후보 → 명시적 선택 → 경로 요청, 오류 후 재시도, 좁은 화면 버튼, 동일 경로 설명.
- Android JVM 테스트·debug APK 빌드·lint 및 GitHub 서명 릴리스 검증. 실제 실행 결과는 배포 확인 후 아래에 기록한다.

## 실제 폰·주행 확인

1. 기존 앱을 삭제하지 않고 1.3.5 APK를 직접 설치하고 설정·즐겨찾기 유지 확인.
2. `94 gerry road` 입력 후 `입력한 주소 검색`을 눌러 Brookline 후보 확인. `94 Gerry Road, Brookline, MA`로도 확인.
3. 폰의 현재 위치에서 선택한 목적지의 경로·동일 경로 안내 확인. 지도상의 출발점과 목적지가 의도한 위치인지 확인.
4. 이후 더 높은 버전이 배포되면 앱 내 다운로드 진행률, 검증 완료, 알 수 없는 앱 설치 허용, 설치 화면 전환 및 데이터 유지 확인. 이번 JVM 테스트는 Android 기기에서의 실제 설치를 대신하지 않는다.
5. 실제 도로 진입·회전 안내·GPS 추종은 별도 주행 확인. 운전 중 화면을 조작하지 않고 동승자 또는 저장 진단 기록으로 확인.

## 실행 결과

- 소스 커밋: `e6e53114a12efb34e00e376faa5ed92de42618ed`.
- 로컬 Node 233개, root/www 브라우저 72개, Android JVM 15개: 총 320개 통과. 브라우저 검색 버튼의 이벤트 전파 문제를 테스트에서 발견해 수정한 뒤 전체 72개를 다시 통과했다.
- `assembleDebug`, `lintDebug` 성공. lint 오류 0개, 기존 경고 19개. root/www 50개 파일 SHA-256 일치. npm audit 취약점 0개.
- [일반 GitHub CI](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40390541625) 및 [APK 검증·배포 워크플로](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40390559504)의 validate/publish 모두 성공.
- 실제 공개 검색 API로 `94 gerry road` 전체 검색 시 Brookline 후보를 첫 번째로 확인했다. 자동완성만으로는 여전히 Photon에 해당 주소가 없으므로 명시적 전체 검색을 사용한다.
- ADB 연결 기기는 없었다. 설치 화면·설정 보존·실제 주행은 확인하지 않았다.

## 공개 배포 파일 검증

- [1.3.5 릴리스](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/app-v1.3.5), [APK 직접 다운로드](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/app-v1.3.5/SolarLessNavi-1.3.5.apk).
- 버전 `1.3.5` / code `9`, 패키지 `com.solaris.nav`, minSdk `22`, debuggable=false.
- APK 크기: `4,381,688` bytes.
- APK SHA-256: `765a2dbebc531cb3aaabfd4bcbe3a466656ec29b9038fb6d911797a94bdbe6f4`.
- 서명 인증서 SHA-256: `59ea18b8ee971936d9e9780a57c4d4594b0c3b9ddbbc6318d1ba6559111f6977`. 기존 1.1.0 이후 정식 APK와 동일.
- 공개 APK를 다시 다운로드해 `apksigner`, `aapt`, 업데이트 manifest 및 SHA256SUMS와 대조했다. APK 안의 app.js/geocoder.js/style.css는 배포 커밋의 Git 원본과 바이트 단위로 일치하며 새 네이티브 UpdateRequest 클래스도 포함돼 있다.
- 공개 update.json을 실제 Capacitor PluginCall JSON으로 재파싱하고 배포 코드의 UpdateRequest에 전달: 기존 getter는 0, 수정된 파서는 크기 4381688 / 버전 9를 읽고 검증 통과. 내려받은 APK의 실제 바이트 수와 해시도 일치했다. JVM 재현이며 Android 기기의 다운로드·설치 전체 실행은 아니다.
- 실제 공개 GitHub 응답을 사용하는 브라우저 업데이트 확인: 현재 버전은 최신, 이전 버전은 업데이트 가능으로 표시. 설치 앱 정보는 시뮬레이션했다.
