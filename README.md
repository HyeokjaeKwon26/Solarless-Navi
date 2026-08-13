# ☀️ SolarLess Navi

태양 위치, 도로 진행 방향, 건물·터널·지형 데이터를 이용해 **빠른 경로**, **눈부심 회피 경로**, **그늘 우선 경로**를 비교하는 Android용 실험적 내비게이션입니다.

[![Platform](https://img.shields.io/badge/Platform-Android-blue.svg?style=for-the-badge&logo=android)](https://developer.android.com)
[![Scene Data](https://img.shields.io/badge/Scene%20Data-USA%20%2B%20Korea-2ea44f.svg?style=for-the-badge)](#미국한국-사전계산-장면-데이터)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)

> SolarLess Navi의 그늘·눈부심·태양 노출 수치는 측정값이 아닌 **실험용 추정값**입니다. 실제 도로 상황, 교통법규와 운전자의 판단을 항상 우선하세요.

## 주요 기능

- **빠른 경로**: OSRM이 반환한 실제 도로 경로 중 예상 소요시간이 가장 짧은 경로를 기준으로 사용합니다.
- **눈부심 회피 경로**: 각 도로 구간의 예상 통과 시각에 태양 방위각·고도각과 차량 진행 방향을 비교합니다.
- **그늘 우선 경로**: 가능한 경우 OSM 건물·터널 형상과 DEM 지형 표본을 이용해 태양 광선 차단 가능성을 계산합니다.
- **빠른 시작과 백그라운드 보정**: 공통 휴리스틱 결과를 먼저 표시하고, 장면 데이터가 준비되면 같은 분석 등급에서 경로를 다시 비교합니다.
- **Android 주행 안내**: 음성 회전 안내, 경로 이탈 재탐색, heading-up 지도, 자동 재중앙 정렬, 선택형 Picture-in-Picture를 지원합니다.
- **회전 지도 조작**: heading-up 또는 수동 회전 상태에서도 터치·드래그 좌표를 지도 회전에 맞게 보정하고, 회전된 지도 모서리가 화면에서 잘리지 않도록 여유 영역을 유지합니다.
- **자동차용 목적지 처리**: 장소·학교·건물의 중심 좌표로 검색하더라도 실제 안내 마커와 도착 판정은 OSRM이 연결한 자동차 도로의 경로 끝을 사용합니다.
- **주소 우선 검색**: 번지와 도로명이 포함된 입력은 구조화된 주소 일치도를 우선하며, 가까운 유사 상호나 장소가 정확한 주소를 밀어내지 않도록 정렬합니다.
- **주행 보조 정보**: OSM 기반 제한속도·STOP·터널 정보와 시간대 보정 예상시간을 표시합니다.

## 동작 방식

```text
OSRM 실제 도로 경로 검색
  → 모든 후보를 공통 휴리스틱으로 빠르게 비교
  → 빠른 경로와 목적별 유력 후보 선정
  → 경로 주변의 사전계산 장면 타일 다운로드·로컬 캐시
  → 건물·터널·지형과 구간별 태양 위치로 후보를 순차 보정
  → 확보된 공통 분석 등급 안에서 최종 경로와 노출 감소율 계산
```

경로 구간 `i`의 예상 통과 시각 `T_i`에서 태양 위치를 다시 계산합니다.

$$T_i = T_{start} + \left(\frac{d_{0 \rightarrow i}}{D_{total}}\right)T_{route}$$

- 태양이 지평선 아래인 야간에는 불필요한 장면 다운로드와 차광 계산을 생략합니다.
- 비교 대상의 분석 등급이 다르면 정밀값과 휴리스틱값을 직접 섞지 않습니다.
- 대안 경로의 태양 노출 추정 감소율은 같은 분석 등급의 빠른 경로를 기준으로 계산합니다.
- 시간은 OSRM 소요시간에 시간대 보정을 적용한 예상값이며 **실시간 교통정보가 아닙니다**.

## 차광·태양 노출 계산법

SolarLess Navi는 **역광 위험**, **실제 차광**, **직접 태양 노출**을 서로 다른 값으로 계산합니다. 태양이 머리 위에 있어 전방 눈부심이 적더라도 건물·지형·터널이 광선을 막지 않으면 태양 노출은 높게 계산됩니다.

### 1. 구간별 태양 위치와 태양 강도

경로 구간 `i`의 위치와 예상 통과 시각 `T_i`에서 태양 고도 `α_i`와 방위각 `A_i`를 계산합니다. 정규화된 태양 강도 `S_i`는 태양이 높을수록 커지고, 태양 고도가 `-6°` 아래인 야간에는 0입니다.

$$0 \le S_i = f(\alpha_i) \le 1$$

`S_i`는 경로 간 상대 비교를 위한 실험용 지표이며 실제 자외선 지수나 조사량이 아닙니다.

### 2. 건물·지형·터널 차광

장면 데이터가 있는 구간에서는 해당 시각의 태양 방향으로 광선을 투사합니다. 광선이 OSM 건물 높이, DEM 지형 단면 또는 터널과 교차하면 차광 `O_i=1`, 차단물이 없다고 확인되면 `O_i=0`으로 둡니다.

$$O_i = \begin{cases}
1, & \text{건물·지형·터널이 태양 광선을 차단함} \\
0, & \text{장면 데이터에서 차단 없음이 확인됨}
\end{cases}$$

장면 데이터가 없는 구간은 실제 그늘로 확정하지 않습니다. 화면에는 도로 방향과 태양 위치에 따른 **추정 그늘 가능성**만 별도로 표시하며, 직접 태양 노출 계산에서는 가짜 차광 이득이 생기지 않도록 보수적으로 `O_i=0`인 노출 구간으로 취급합니다.

### 3. 직접 태양 노출

구간의 직접 태양 노출 `E_i`는 태양 강도와 실제 차광 여부만으로 계산합니다.

$$E_i = S_i(1-O_i)$$

경로 전체의 태양 노출 지표 `E_{route}`는 구간 거리 `d_i`로 가중 평균합니다.

$$E_{route} = \frac{\sum_i E_i d_i}{\sum_i d_i}$$

따라서 태양이 높고 탁 트인 도로는 역광 위험이 낮더라도 `E_i`가 높습니다. 반대로 터널이나 건물·산이 태양을 실제로 가리면 `E_i`는 0에 가까워집니다.

### 4. 확인된 그늘 비율

`확인된 그늘`은 장면 데이터로 판정할 수 있었던 거리만을 분모로 사용합니다.

$$C_{shade} = \frac{\sum_i d_i\,\mathbf{1}[O_i=1]}{\sum_i d_i\,\mathbf{1}[O_i\text{가 확인됨}]}$$

예를 들어 `장면 80% 분석 · 확인된 그늘 30%`는 전체 경로의 80%에서 건물·지형 판정이 가능했고, 그 분석 가능 구간 중 30%에서 차광이 확인됐다는 의미입니다. 나머지 20%를 그늘이라고 의미하지 않습니다.

### 5. 역광 위험은 별도 계산

차량 진행 방위 `H_i`와 태양 방위 `A_i`의 최소 각도 차이를 `Δ_i`라고 합니다.

$$\Delta_i = \min(|H_i-A_i|,\,360^\circ-|H_i-A_i|)$$

태양이 낮고 차량 정면에 가까울수록 역광 위험 `G_i`가 커집니다. 역광 값은 눈부심 회피 경로 선택에만 사용하며 `E_i`를 낮추는 계수로 사용하지 않습니다.

### 6. 경로 간 태양 노출 감소율

대안 경로의 감소율은 반드시 같은 분석 등급의 빠른 경로를 기준으로 계산합니다.

$$R = 100\left(1-\frac{E_{candidate}}{E_{fastest}}\right)$$

서로 다른 분석 등급의 숫자는 직접 비교하지 않습니다. 정밀 비교 기준을 만들 수 없으면 모든 후보를 공통 휴리스틱 등급으로 되돌립니다. 그늘 우선 경로는 최대 35%의 시간 증가 범위에서 태양 노출이 5% 이상 감소하거나 확인된 그늘 비율이 5%포인트 이상 증가할 때만 대안으로 선택할 수 있습니다.

> **면책 및 안전 고지:** 태양 노출, 확인된 그늘, 추정 그늘 가능성, 역광 위험은 공개 지도·고도 데이터와 수학적 모델로 계산한 실험용 상대 지표입니다. 실제 UV 선량, 일사량, 피부 노출, 차량 내부 온도, 열질환·안과 질환 위험 또는 의학적 보호 효과를 측정하거나 보장하지 않습니다. 건물·수목·공사·터널·지형·날씨와 도로 데이터가 누락되거나 오래됐을 수 있습니다. 경로 선택과 운전 중에는 현장 표지, 교통법규, 기상 상태, 도로 상황과 운전자의 안전 판단을 항상 우선하세요. 앱 화면을 조작하거나 수치를 확인하기 위해 주행 중 주의를 분산시키지 마세요.

## 분석 등급

| 앱 표시 | 의미 |
| :--- | :--- |
| **정밀 장면** | 비교에 필요한 건물·터널·지형 데이터를 확보해 2.5D 태양 광선 교차를 계산한 결과 |
| **부분 장면** | 확보된 구간에는 실제 차광 계산을 적용하고, 미확인 구간에는 추정 그늘 가능성을 별도 표시하되 직접 태양 노출에는 차광 이득을 적용하지 않은 결과 |
| **휴리스틱** | 장면 데이터를 사용할 수 없어 태양 위치와 도로 방향으로 그늘 가능성을 추정하되 실제 그늘로 확정하지 않은 결과 |
| **야간** | 태양 고도가 충분히 낮아 장면 차광 분석이 필요하지 않은 상태 |

건물 높이 태그가 없으면 층수 또는 보수적인 기본 높이를 사용할 수 있고, DEM은 유한한 해상도의 표본입니다. 따라서 정밀 장면도 실제 건축물의 완전한 3D 모델이나 측정된 차광률을 의미하지 않습니다.

## 미국·한국 사전계산 장면 데이터

미국과 한국 내 경로에서는 필요한 **5km 장면 타일만** GitHub Release에서 내려받아 기기에 캐시합니다. 앱 시작 시 전체 데이터를 받지 않으며, 다음 주행부터 캐시된 타일을 재사용합니다.

경로가 둘 이상의 데이터 권역을 통과하면 각 권역의 필요한 타일을 함께 사용합니다. 특정 타일이 없거나 다운로드에 실패하면 사용 가능한 구간은 부분 장면으로 유지하고, 나머지 구간은 휴리스틱으로 전환합니다. 사전계산 타일을 사용할 수 없는 경우에는 제한된 Overpass/OpenTopoData 조회를 시도할 수 있습니다.

<details>
<summary>장면 데이터 Release 및 버전 정보</summary>

| 데이터 권역 | 5km 타일 | v2 ZIP 자산 | Release |
| :--- | ---: | ---: | :--- |
| Northeast | 7,221 | 478 | [scene-us-northeast-hybrid-v2](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-northeast-hybrid-v2) |
| Midwest | 43,668 | 899 | [scene-us-midwest-hybrid-v2](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-midwest-hybrid-v2) |
| South | 47,524 | 899 | [scene-us-south-hybrid-v2](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-south-hybrid-v2) |
| West | 42,575 | 899 | [scene-us-west-hybrid-v2](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-west-hybrid-v2) |
| South Korea | 3,961 | 153 | [scene-kr-hybrid-v1](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-kr-hybrid-v1) |

각 manifest에는 타일과 ZIP의 대응 관계, 파일 크기, SHA-256, 생성 시각과 데이터 출처 메타데이터가 기록됩니다. ZIP 전체를 메모리에 펼치지 않고 경로에 필요한 JSON 항목만 Worker에서 선택적으로 해제·파싱합니다.

</details>

## 설치와 실행

현재 제품 지원과 검증의 중심은 Android입니다. 위치 권한을 허용하지 않아도 장소 검색은 사용할 수 있지만, 현재 위치 출발과 실시간 주행 안내에는 위치 권한과 GPS 신호가 필요합니다.

앱의 지도, 주소 검색, 경로 계산과 처음 사용하는 장면 타일 다운로드에는 인터넷 연결이 필요합니다. 다운로드한 장면 타일은 로컬 캐시에 보관되지만, 실제 도로 경로는 오프라인에서 새로 계산하지 않습니다.

## 알아두어야 할 점

- 그늘·눈부심·태양 노출 감소율은 실제 UV 선량, 차량 내부 온도, 의학적 보호 효과 또는 안전을 보장하지 않습니다.
- 경로 계산은 무료 공개 OSRM 서비스에 의존하므로 장애나 rate limit으로 실패할 수 있습니다.
- 주소 검색과 역지오딩은 Nominatim·Photon 상태와 데이터 품질에 영향을 받습니다.
- 제한속도와 도로 규칙은 OSM 태그 기반이며 실제 표지판과 다르거나 오래되었을 수 있습니다.
- 무료도로 옵션은 가능한 후보에서 통행료 태그를 회피하지만 모든 지역의 통행료 정보를 보증하지 않습니다.
- 지도 타일, 검색, 경로와 일부 장면 fallback은 외부 네트워크가 필요합니다.
- Android 기종과 OS의 절전 정책에 따라 백그라운드 위치 및 PiP 동작이 달라질 수 있습니다.

## 외부 서비스와 개인정보

기능 사용 시 위치, 경로 좌표 또는 검색어가 아래 외부 서비스로 전송될 수 있습니다.

| 목적 | 서비스 |
| :--- | :--- |
| 도로 경로 계산 | OSRM |
| 장소·주소 검색 및 국가 판별 | OSM Nominatim, Photon by Komoot |
| 도로 규칙·장면 fallback | OSM Overpass API |
| 지형 fallback | OpenTopoData ASTER30m |
| 지도 표시 | Esri, CARTO, OpenStreetMap 기반 타일 |
| 사전계산 장면 다운로드 | GitHub Releases |

공개 서비스는 이용 제한, 장애 또는 정책 변경이 발생할 수 있습니다. 앱은 외부 장면 데이터 실패 시 실제 OSRM 경로 자체를 버리지 않고, 가능한 범위에서 휴리스틱 분석으로 전환합니다.

## 개발 환경과 빌드

필요한 환경:

- Node.js 20+
- JDK 17
- Android Studio 또는 Android SDK
- 저장소에 포함된 Gradle Wrapper

```bash
npm ci
npm test
npx @capacitor/cli sync android
```

개발용 debug APK:

```cmd
android\gradlew.bat assembleDebug
```

서명된 release APK:

```cmd
build_apk.bat
```

릴리즈 서명 정보는 저장소 밖에서 다음 환경변수 또는 사용자 Gradle properties로 제공해야 합니다.

- `RELEASE_STORE_FILE`
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS`
- `RELEASE_KEY_PASSWORD`
- `EXPECTED_SIGNING_CERT_SHA256` — 선택적 인증서 고정 검증

`build_apk.bat`는 JDK와 서명 설정을 확인하고, 빌드 결과를 `apksigner`로 검증한 후 루트에 `SolarLessNavi_v1.0.apk`를 만듭니다.

### 장면 데이터 도구

지역 장면 데이터를 유지보수할 때 사용합니다. 일반 앱 빌드에는 필요하지 않습니다.

```bash
npm run scene:build
npm run scene:package
node tools/validate-scene-release.mjs
```

상세 설정은 [`data/scene`](data/scene) 아래의 지역별 manifest와 README를 참고하세요.

## 기술 스택과 데이터 출처

| 구분 | 기술·데이터 |
| :--- | :--- |
| Android wrapper | [Capacitor 6](https://capacitorjs.com/) — MIT |
| 지도 렌더링 | [Leaflet 1.9.4](https://leafletjs.com/) — BSD-2-Clause |
| 도로·건물·터널 데이터 | [OpenStreetMap](https://www.openstreetmap.org/) contributors — [ODbL](https://opendatacommons.org/licenses/odbl/) |
| 경로 계산 | [OSRM](https://project-osrm.org/) |
| 장소 검색 | [Nominatim](https://nominatim.org/), [Photon](https://photon.komoot.io/) |
| 지도 타일 | [Esri](https://www.esri.com/en-us/arcgis/products/arcgis-online/overview), [CARTO](https://carto.com/attributions) |
| 지형 표본 | [OpenTopoData ASTER30m](https://www.opentopodata.org/datasets/aster/) |
| 태양 위치 | [SunCalc](https://github.com/mourner/suncalc) — BSD-2-Clause |
| ZIP 처리 | [fflate](https://github.com/101arrowz/fflate) — MIT |
| 아이콘·글꼴 | [Font Awesome 6](https://fontawesome.com/) — CC BY 4.0 / SIL OFL 1.1 / MIT |

지도 화면의 출처 표시는 각 데이터·타일 제공자의 라이선스 조건에 따라 유지됩니다.

## 라이선스

이 프로젝트는 [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0)으로 배포됩니다. 수정·재배포하거나 이 코드를 기반으로 네트워크 서비스를 운영할 때는 AGPL-3.0의 소스 공개 의무를 확인하세요.

## 개발자

**Hyeokjae Kwon, M.D., Ph.D. (권혁재)**

[https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/)

---

<details>
<summary><strong>English summary</strong></summary>

### SolarLess Navi

SolarLess Navi is an experimental Android navigation app that compares the fastest, lower-glare, and shade-preferred routes using solar position, road direction, and—when available—precomputed U.S. and South Korean building, tunnel, and terrain scene tiles.

The Android map compensates touch and drag coordinates while heading-up or manually rotated. Address searches prioritize structured house-number and road matches, and navigation uses the final OSRM road coordinate for its destination marker and arrival check rather than a building centroid. Cancelling guidance clears the previous destination and route-card state.

The app displays an initial common-heuristic result quickly and refines competitive routes as scene data becomes available. It downloads only the 5 km tiles required around the route, caches them locally, and can combine multiple regional releases for boundary-crossing trips. Missing coverage is explicitly reported as partial scene analysis. Unverified segments keep a separate heuristic shade-potential value but receive no artificial shade benefit in the direct-exposure score.

#### Shade and solar-exposure calculation

SolarLess Navi calculates **windshield glare**, **confirmed occlusion**, and **direct solar exposure** as separate quantities. A high overhead sun can produce little forward glare while still producing high solar exposure on an open road.

For route segment `i`, the app computes solar altitude `α_i` and azimuth `A_i` at the estimated pass time. Normalized solar intensity is:

$$0 \le S_i=f(\alpha_i)\le1$$

`S_i` is an experimental relative index, not a measured UV index or radiant dose. Where scene data is available, a sun ray is tested against OSM building heights, DEM terrain profiles, and tunnels:

$$O_i=\begin{cases}
1,&\text{the sun ray is blocked by a building, terrain, or tunnel}\\
0,&\text{the scene confirms a clear sun ray}
\end{cases}$$

Direct solar exposure is independent of glare:

$$E_i=S_i(1-O_i)$$

The route exposure index is distance weighted:

$$E_{route}=\frac{\sum_i E_i d_i}{\sum_i d_i}$$

An overhead unobstructed sun therefore remains high exposure even when forward glare is low. Confirmed building, terrain, or tunnel shade reduces direct exposure to zero for that segment. A segment without scene coverage is never labeled confirmed shade; it receives a separate heuristic shade-potential value and is conservatively treated as exposed in the direct-exposure score.

Confirmed shade uses only scene-verifiable distance as its denominator:

$$C_{shade}=\frac{\sum_i d_i\,\mathbf{1}[O_i=1]}{\sum_i d_i\,\mathbf{1}[O_i\text{ is known}]}$$

Thus, “80% scene coverage · 30% confirmed shade” means that 80% of the route was scene-verifiable and 30% of that verifiable distance was confirmed shaded. It does not claim that the unverified 20% is shaded.

Glare uses the angular difference between vehicle heading `H_i` and solar azimuth `A_i`:

$$\Delta_i=\min(|H_i-A_i|,\,360^\circ-|H_i-A_i|)$$

Low sun close to the vehicle heading produces higher glare. Glare affects the glare-avoidance route only and is not multiplied into direct solar exposure.

Exposure reduction is calculated against the fastest route from the same analysis tier:

$$R=100\left(1-\frac{E_{candidate}}{E_{fastest}}\right)$$

Values from different analysis tiers are never compared directly. If a common precision baseline is unavailable, candidates revert to a common heuristic tier. A shade alternative must stay within the configured 35% time-detour ceiling and provide at least a 5% exposure reduction or a 5-percentage-point confirmed-shade improvement.

> **Disclaimer and safety notice:** Solar exposure, confirmed shade, estimated shade potential, and glare risk are experimental relative indicators derived from public map/elevation data and mathematical models. They do not measure or guarantee actual UV dose, solar irradiance, skin exposure, cabin temperature, heat-illness or eye-disease risk, medical protection, or driving safety. Buildings, vegetation, construction, tunnels, terrain, weather, and road data may be missing, outdated, or inaccurate. Always prioritize traffic laws, road signs, weather, actual road conditions, and the driver's judgment. Do not interact with the app or inspect its estimates in a way that distracts from driving.

#### Important limitations

- Shade, glare, and exposure-reduction values are experimental estimates, not measured UV dose, temperature, medical protection, or a safety guarantee.
- Travel duration is an OSRM duration with a time-of-day adjustment, not live traffic.
- A network connection is required for new road routes, map tiles, search, and uncached scene data.
- Location, route coordinates, or search terms may be sent to OSRM, Nominatim, Photon, Overpass, OpenTopoData, GitHub Releases, Esri, or CARTO.
- Public services can be unavailable or rate-limited; scene failure falls back to heuristic analysis without inventing a road route.

#### Build

Node.js 20+, JDK 17, and the Android SDK are required.

```bash
npm ci
npm test
npx @capacitor/cli sync android
```

Use `android\gradlew.bat assembleDebug` for a debug build or `build_apk.bat` with an external signing keystore for a verified release APK.

This project is licensed under GNU AGPL-3.0.

</details>
