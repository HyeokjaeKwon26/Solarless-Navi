# ☀️ SolarLess Navi - 햇빛을 피하는 스마트 내비게이션 (Android)

[🇰🇷 한국어](#-solarless-navi---햇빛을-피하는-스마트-내비게이션-android) | [🇺🇸 English](#-solarless-navi---sun-glare--shade-aware-smart-navigation-android)

[![Platform](https://img.shields.io/badge/Platform-Android%208.0%2B-blue.svg?style=for-the-badge&logo=android)](https://developer.android.com)
[![Author](https://img.shields.io/badge/Author-권혁재%20M.D.%2C%20Ph.D.-orange.svg?style=for-the-badge)](https://hyeokjaekwon26.github.io/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)

> **"운전 중 태양 방향과 도로 방향을 비교해 실험용 노출 지표를 확인하세요."**
> 
> **SolarLess Navi**는 현재 시각의 태양 위치(방위각/고도)와 OpenStreetMap/OSRM 도로 경로를 이용해 **① 그늘 가능성 추정이 높은 경로**와 **② 정면 태양 눈부심(역광) 가능성 추정이 낮은 경로**를 비교하는 Android 중심 실험용 내비게이션입니다. OSM 건물·터널 형상과 공개 DEM 표본이 제공될 때는 태양 광선과 2.5D 장애물을 추가로 교차 검사하지만, 건물 높이·등고선·수치 결과는 추정값이며 실시간 교통은 측정하지 않습니다.

---

## 👨‍💻 개발자 정보 (Developer Information)
* **저작자 / 개발자**: **권혁재 M.D., Ph.D. (Hyeokjae Kwon, M.D., Ph.D.)**
* **공식 홈페이지**: [https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/)

---

## ✨ 핵심 듀얼 기능 (Core Dual Pillars)

### 🌲 1. 그늘 가능성 추정 경로 안내
* **장면 데이터 보정**: OSM Overpass의 건물/터널 형상·건물 높이 태그와 OpenTopoData ASTER30m 고도 표본을 이용해 태양 광선 차단 가능성을 검사합니다. API가 실패하거나 데이터가 없는 구간은 도로 방향 기반 휴리스틱 추정으로 표시됩니다.
* **휴리스틱·실험용 추정**: 건물 높이가 없으면 층수 또는 보수적인 기본 높이를 사용하고, DEM은 제한된 방향 표본만 조회합니다. 실제 차광률·UV 선량·온도를 측정하지 않습니다.
* **실험용 비교 지표**: 실제 차광률이나 실내 온도를 측정하지 않고 경로 간 상대적인 태양 노출 가능성만 비교합니다.

### 🕶️ 2. 역광(눈부심) 회피 및 직사광선 차단 경로
* **NOAA AA+ 천문학 연산 기반**: 운전자의 GPS 위치와 주행 시각에 따른 태양 방위각(Azimuth) 및 고도각(Elevation)을 실시간 연산합니다.
* **전면 유리창 직사광선 차단**: 태양이 운전자의 정면 전면유리로 찌르는 서쪽 저녁 노을/아침 동쪽 태양 구간을 우회하는 안전 경로를 추천합니다.

### ☀️ 3. 태양 노출 추정 감소율(%) 표시 & 4D 시공간 주행 예측
* **4D 시공간(Spatio-Temporal) 동적 태양광 연산**: 출발 시각 스냅샷이 아닌, 차량이 각 도로 세그먼트($i$)를 통과할 것으로 예상되는 시각($T_i = T_{\text{start}} + \Delta t_i$)의 태양 방위각/고도각을 구간별로 계산합니다. 시간대 보정 예상시간과 OSRM step geometry를 사용한 실험용 모델입니다.
* **실험용 추정값 표기**: 특정 경로를 과학적으로 보증하지 않으며, 모든 경로 카드에 역광 가능성 추정과 태양 노출 추정 감소율을 상대 지표로 표시합니다.
* **단일 경로/야간 자동 분기**: 대안 우회로가 없으면 동일 경로를 각 역할에 재사용하며, 그늘·역광은 추정 지표로 표시합니다. 일몰 후에는 야간 추정으로 전환됩니다.
* **💡 직사 태양 노출 추정 감소율(%)**: 차량 유리나 썬팅을 측정하지 않습니다. 정밀 또는 공통 휴리스틱 계층 안에서 최단 경로를 기준으로 계산하는 상대적 실험 지표이며 의학적 보호 효과를 의미하지 않습니다.

### 🚥 4. OSM 조회 기반 제한속도 & 표지판 (한국/글로벌 🔴 / 미국 ⬜)
* OpenStreetMap `Overpass API`에서 주변 도로 태그를 조회해 제한속도·STOP·터널·톨게이트 정보를 표시합니다. 데이터가 없거나 오래되었을 수 있습니다.
* **지역 단위 표시**: 명시적인 `mph`/`km/h` OSM 태그와 reverse-geocoding ISO 코드를 우선하며, 국가를 확정할 수 없으면 안전한 국제 기본값(km/h)을 사용합니다.
* **미국 도로 (MUTCD 규격 표준)**: 흰색 사각형 표지판 (mph) & 8각 STOP 표지판 지원

### 🗣️ 5. 스마트 맞춤형 음성 안내 (TTS & 경고음)
* 경로 시작 시 **태양 노출 추정치**를 참고 정보로 음성 안내합니다. 이 수치는 측정값이나 의학적 보호 효과가 아닙니다.
* 과속 및 200m 앞 강한 역광 위험 구간 진입 시 자동차 전용 2톤 경고음(Dong-Dong)을 재생합니다.

### ⚙️ 6. 스마트 주행 편의 기능 (Smart Convenience Features)
* **근처 쉼터/주차장 검색**: 장소 검색 결과를 경유지 후보로 제시합니다. 실제 그늘 여부를 검증하지 않습니다.
* **사용자 선호 경로 자동 기억 (Smart Preference Memory)**: 마지막 주행에서 선택한 경로 모드(최단/역광회피/그늘)를 기억하여 다음 주행 시 해당 모드를 기본 안내 경로로 자동 지정.
* **25초 자동 복귀 링 HUD (Auto-Recenter HUD)**: 주행 중 지도를 탐색하더라도 조작 중단 25초 후 차량 중심 위치로 부드럽게 자동 복귀.
* **로컬 정적 자산 번들링**: 폰트·아이콘·지도 렌더러 일부는 앱에 포함되지만 지도 타일·검색·경로 계산은 외부 네트워크가 필요합니다.
* **고화질 항공 위성 지도 뷰**: ESRI World Imagery 고화질 항공 위성 사진 레이어 1-터치 전환 지원.
* **야간/터널 자동 다크모드**: 일몰 후 및 터널 진입 시 어두운 야간 내비게이션 테마로 자동 전환.
* **무료 도로 우선 (통행료 회피)**: 고속도로 통행료를 회피하는 국도/일반도로 우선 탐색 옵션.
* **OLED 발열 & 배터리 절전 모드**: 장시간 내비게이션 구동 시 기기 발열 방지 및 배터리 절약 모드.

---

## 🔬 핵심 연산 원리 (How it Works)

### 1. 4차원 시공간(4D Spatio-Temporal) 세그먼트별 미래 태양 위치 연산
각 도로 구간 $i$마다 차량의 예상 진입 시각 $T_i$를 구하여 해당 시점의 태양 고도($\theta_{s, i}$) 및 방위각($\phi_{\text{sun}, i}$)을 개별 산출합니다.

$$T_i = T_{\text{start}} + \left( \frac{\sum_{k=1}^{i-1} d_k + \frac{d_i}{2}}{D_{\text{total}}} \right) \times T_{\text{total}}$$

* $(\theta_{s, i}, \phi_{\text{sun}, i}) = \text{SunCalc}(T_i, \text{lat}_i, \text{lng}_i)$

### 2. 태양 노출 추정 감소율 연산 ($\Delta E_{\text{solar}}$)
최단 경로 대비 대안 경로의 상대적인 태양 노출 추정 감소율입니다. 실제 UV 선량이 아닙니다:

$$\Delta E_{\text{solar}} = \left( 1 - \frac{\sum_{i \in \text{Alternative}} \sin(\theta_{s, i}) \cdot (1 - S_i \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_i) \cdot \Delta t_i}{\sum_{j \in \text{Fastest}} \sin(\theta_{s, j}) \cdot (1 - S_j \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_j) \cdot \Delta t_j} \right) \times 100$$

* $\text{Alternative}$ / $\text{Fastest}$: 추천 우회 경로 / 최단 기본 경로
* $\theta_{s, i}$: 구간 $i$ 통과 시점의 실시간 태양 고도각 (Solar Elevation Angle at $T_i$)
* $S_i$: 도로 방향과 태양각으로 추정한 그늘 가능성 (Shade Possibility Estimate, $0.0 \sim 1.0$)
* $\Delta t_i$: 해당 도로 구간 주행 소요 시간 (초)

### 3. 전면 유리창 역광 위험도 연산 수식 ($\text{GlareRisk}_i$)
$$\text{GlareRisk}_i = \left( 1 - \frac{|\phi_{\text{road}, i} - \phi_{\text{sun}, i}|}{45^\circ} \right) \times \left( 1 - \frac{\theta_{s, i}}{25^\circ} \right)$$

* **적용 조건**: 주행 방향과 태양 방위각 차이 $|\phi_{\text{road}, i} - \phi_{\text{sun}, i}| \le 45^\circ$ 및 태양 고도 $0^\circ < \theta_{s, i} < 25^\circ$ (조건 미충족 시 $\text{GlareRisk}_i = 0$)
* $\phi_{\text{road}, i}$: 차량 주행 도로 방위각 / $\phi_{\text{sun}, i}$: $T_i$ 시점의 실시간 태양 방위각 (Sun Azimuth)

---

## 🛠️ 기술 스택 & 오픈 API (Tech Stack)

| 구분 | 기술 / 오픈 API 명세 |
| :--- | :--- |
| **Framework** | Ionic Capacitor 6 (Native Android Wrapper) |
| **Map Rendering** | Leaflet.js 1.9.4 (100% Local Bundled) |
| **Icons & Fonts** | FontAwesome 6 (Local WebFonts Asset Packaging) |
| **Routing Engine** | Open Source Routing Machine (`OSRM Driving API`) |
| **Speed Limit & Rules** | OpenStreetMap `Overpass API` (`maxspeed`, `highway=stop`) |
| **Place Search** | OSM `Nominatim` & `Photon Komoot API` |
| **Solar Calculations** | Astronomical AA+ Julian Day Formulas (`SunCalc.js`) |
| **Building / Terrain Occlusion** | OpenStreetMap `Overpass API` + OpenTopoData `ASTER30m` (bounded ray probes) |
| **Audio & TTS** | Capacitor Native TextToSpeech & Web Audio Synth |

---

## 💻 소스코드 안드로이드 빌드 방법 (How to Build)

개발자가 소스코드를 직접 수정하여 APK를 빌드하려면 아래 명령어를 순서대로 실행하세요.

### 1. 의존성 설치 및 씽크
```bash
npm ci
npx @capacitor/cli sync android
```

### 2. 안드로이드 APK 빌드 실행
```cmd
cmd /c "build_apk.bat"
```
빌드가 완료되면 루트 디렉토리에 **`SolarLessNavi_v1.0.apk`**가 생성됩니다.

릴리스 빌드에는 JDK 17, Android SDK/Gradle 및 서명 키스토어가 필요합니다. 키스토어와 비밀번호는 저장소에 넣지 말고 사용자 Gradle properties 또는 다음 환경변수로만 제공합니다: `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`. 값이 없으면 스크립트는 실패하며 debug APK를 release APK로 복사하지 않습니다. 서명 없이 기능만 확인하려면 `android\gradlew.bat assembleDebug`를 사용하세요. `npm test`도 빌드 전 실행하세요.

### 실행 범위와 한계
* 경로 계산은 무료 공개 OSRM 서비스에 의존하며, 네트워크 장애나 이용 제한이 발생할 수 있습니다.
* Nominatim, Photon, Overpass 및 지도 타일(Esri/CARTO)을 사용할 때 검색어와 위치 정보가 해당 외부 서비스로 전송될 수 있습니다.
* 시간은 OSRM geometry/step을 재사용하면서 시간대별 고정 보정을 적용한 **예상시간**이며 실시간 교통 정보가 아닙니다. 시간 슬라이더 변경은 OSRM을 다시 호출하지 않고 태양 분석을 갱신합니다.
* 건물·터널·지형 데이터가 조회되면 제한된 2.5D 광선 교차 결과를 반영하지만, 데이터 범위·높이 태그·DEM 해상도에 따라 **휴리스틱, 부분 장면, 정밀 장면** 계층으로 표시됩니다. 역할별로 같은 계층의 최단 기준과만 비교하며, 장면 API 실패 시 해당 역할은 휴리스틱으로 fallback합니다. 실제 차광률, UV 선량, 온도 또는 안전을 보장하지 않습니다.
* 공개 OSRM, Overpass, OpenTopoData, Nominatim/Photon 및 Esri/CARTO 타일은 rate limit·장애·정책 변경이 있을 수 있습니다. 지도 출처 표시는 라이선스 조건상 제거할 수 없습니다.

---

## 📜 오픈소스 및 데이터 출처 고지 (Open Source Credits)

본 프로젝트는 아래의 오픈소스 프로젝트 및 오픈 API를 활용하여 개발되었습니다.

* **지도 데이터 및 경로 검색:** Map data © [OpenStreetMap](https://openstreetmap.org) contributors ([ODbL 라이선스](https://opendatacommons.org/licenses/odbl/) 준수)
* **지도 타일 제공자:** [Esri World Street/Imagery](https://www.esri.com/en-us/arcgis/products/arcgis-online/overview) 및 [CARTO](https://carto.com/attributions) (각 제공자의 이용 조건과 attribution 준수 필요)
* **지도 렌더링 엔진:** [Leaflet.js](https://leafletjs.com/) (BSD 2-Clause 라이선스)
* **하이브리드 앱 프레임워크:** [Ionic Capacitor](https://capacitorjs.com/) (MIT 라이선스)
* **아이콘 및 폰트:** [FontAwesome 6](https://fontawesome.com/) (CC BY 4.0 / SIL OFL 1.1 / MIT 라이선스)
* **위치 검색 API:** [Photon Komoot API](https://photon.komoot.io/) (Apache 2.0 라이선스) & OSM Nominatim
* **건물·터널 데이터:** [OpenStreetMap Overpass API](https://overpass-api.de/) (OSM 데이터 및 ODbL 조건 준수)
* **지형 표본:** [OpenTopoData ASTER30m](https://www.opentopodata.org/datasets/aster/) 공개 DEM API (서비스 이용 제한 및 데이터 해상도 적용)
* **태양 고도/방위각 계산:** [SunCalc.js](https://github.com/mourner/suncalc) (BSD 2-Clause 라이선스)

---

## ⚖️ 라이선스 (License)

본 프로젝트는 **[GNU Affero General Public License v3.0 (GNU AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0)** 라이선스를 적용합니다.

* **저작자 (Author)**: **권혁재 M.D., Ph.D. (Hyeokjae Kwon, M.D., Ph.D.)** ([https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/))
* **자유로운 사용 및 공유**: 소스코드 조회, 실행, 수정, 연구 및 학술적 재배포가 자유롭게 보장됩니다.
* **강력한 카피레프트 (Strong Copyleft)**: 본 프로젝트의 소스코드를 수정하거나 이를 기반으로 파생된 소프트웨어 및 네트워크/클라우드 서비스(SaaS)를 운영할 경우, 동일하게 **AGPL-3.0 라이선스 하에 전체 소스코드를 의무적으로 공개**해야 합니다. (특정 기업/단체의 독점 폐쇄 상용화 방지)

<br><hr><br>

# ☀️ SolarLess Navi - Sun Glare & Shade-Aware Smart Navigation (Android)

[🇰🇷 한국어](#-solarless-navi---햇빛을-피하는-스마트-내비게이션-android) | [🇺🇸 English](#-solarless-navi---sun-glare--shade-aware-smart-navigation-android)

[![Platform](https://img.shields.io/badge/Platform-Android%208.0%2B-blue.svg?style=for-the-badge&logo=android)](https://developer.android.com)
[![Author](https://img.shields.io/badge/Author-Hyeokjae%20Kwon%2C%20M.D.%2C%20Ph.D.-orange.svg?style=for-the-badge)](https://hyeokjaekwon26.github.io/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)

> **"Compare sun direction and road direction with experimental exposure indicators."**
> 
> **SolarLess Navi** is an Android-focused experimental navigation application that uses current solar position (azimuth/elevation) and real OSRM/OpenStreetMap routes to compare **① higher estimated shade-possibility routes** and **② lower estimated glare-possibility routes**. When available, OSM building/tunnel geometry and public DEM samples are used for bounded 2.5D sun-ray obstruction checks; this is not live traffic or a full 3D survey.

---

## 👨‍💻 Developer Information
* **Author / Developer**: **Hyeokjae Kwon, M.D., Ph.D. (권혁재 M.D., Ph.D.)**
* **Official Website**: [https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/)

---

## ✨ Core Dual Pillars

### 🌲 1. Estimated Shade-Possibility Route Guidance
* **Scene-assisted estimate**: Uses OSM Overpass building/tunnel geometry and OpenTopoData ASTER30m elevation samples for bounded 2.5D sun-ray checks. Missing or failed external data falls back to the road-direction heuristic and is labeled accordingly.
* **Heuristic estimate**: Building heights without tags use a level-based or conservative default height, while terrain is sampled along a few sun-facing probes; this is not a complete 3D building/terrain model.
* **Experimental comparison only**: It does not measure actual shade coverage, cabin temperature, or UV dose.

### 🕶️ 2. Glare-Free Avoidance Route Guidance
* **Astronomical calculations**: Computes solar azimuth and elevation estimates in real time based on driver GPS coordinates.
* **Windshield Glare Protection**: Re-routes around roads heading directly into low-angle morning/evening sun glare.

### ☀️ 3. Estimated Solar Exposure Reduction (%) & 4D Spatio-Temporal Simulation
* **4D Spatio-Temporal Solar Estimate**: Recomputes solar azimuth/elevation for each segment at its projected arrival time ($T_i = T_{\text{start}} + \Delta t_i$), using the OSRM geometry and time-of-day adjusted expected duration. It is an experimental estimate, not a full physical simulation.
* **Experimental estimate labels**: Displays estimated glare possibility and relative solar-exposure reduction on every route card; these are not measured or medically validated values.
* **Single Route & Night Mode**: Reuses the same route when no meaningful alternative exists and labels shade/glare values as estimates. Night handling is an estimate after sunset.
* **💡 Estimated direct-sun exposure reduction (%)**: The app does not measure vehicle glass, tinting, skin dose, or medical protection. The percentage is a relative experimental indicator calculated against the fastest route within the same analysis tier.

### 🚥 4. OSM Tag Lookup for Speed Limits & Road Signs
* Queries nearby OpenStreetMap `Overpass API` tags for speed limits, STOP signs, tunnels, and toll information. Coverage and freshness depend on OSM data.
* **Regional units**: Explicit `mph`/`km/h` tags and reverse-geocoded ISO country codes take priority; uncertain locations use the international km/h default.
* **USA (MUTCD Standard)**: White Rectangular Speed Limit Sign (mph) & 8-sided STOP sign.

### 🗣️ 5. Smart Adaptive Voice Guidance (TTS & Warnings)
* Announces solar-exposure estimates as informational guidance only; they are not measured UV protection claims.
* Alerts driver with two-tone automotive chimes when approaching severe glare zones or exceeding speed limits.

### ⚙️ 6. Smart Convenience Features
* **Nearby rest/parking search**: Uses place-search results as waypoint candidates; it does not verify that a place is actually shaded.
* **Smart Route Mode Memory**: Memorizes the driver's last selected route mode (Fastest, Glare-Free, Shade) and automatically sets it as the default for subsequent trips.
* **25s Auto-Recenter Ring HUD**: Automatically recenters the map to the vehicle position after 25 seconds of inactivity.
* **Local static asset bundling**: Fonts, icons, and the map renderer are bundled, but map tiles, place search, road rules, and routing still require external network services.
* **High-Resolution Aerial Satellite Map View**: ESRI World Imagery high-resolution aerial satellite layer toggle.
* **Night & Tunnel Auto Dark Mode**: Automatically shifts to dark navigation theme after sunset or in tunnels.
* **Toll-Free Preference**: Avoid toll roads and highways with dedicated routing filters.
* **OLED Thermal & Battery Saver**: Reduces power consumption and device heat during long navigation sessions.

---

## 🔬 How It Works (Physics & Math Model)

### 1. 4D Spatio-Temporal Future Solar Position per Segment
For each road segment $i$, the vehicle's projected arrival timestamp $T_i$ is computed:

$$T_i = T_{\text{start}} + \left( \frac{\sum_{k=1}^{i-1} d_k + \frac{d_i}{2}}{D_{\text{total}}} \right) \times T_{\text{total}}$$

* $(\theta_{s, i}, \phi_{\text{sun}, i}) = \text{SunCalc}(T_i, \text{lat}_i, \text{lng}_i)$

### 2. Relative Solar-Exposure Estimate ($\Delta E_{\text{solar}}$)
$$\Delta E_{\text{solar}} = \left( 1 - \frac{\sum_{i \in \text{Alternative}} \sin(\theta_{s, i}) \cdot (1 - S_i \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_i) \cdot \Delta t_i}{\sum_{j \in \text{Fastest}} \sin(\theta_{s, j}) \cdot (1 - S_j \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_j) \cdot \Delta t_j} \right) \times 100$$

* $\text{Alternative}$ / $\text{Fastest}$: Recommended Alternative Route / Baseline Fastest Route
* $\theta_{s, i}$: Real-time Solar Elevation Angle at $T_i$
* $S_i$: Heuristic road-segment shade-possibility estimate ($0.0 \sim 1.0$), not measured building/terrain coverage
* $\Delta t_i$: Travel duration on segment $i$ (seconds)

### 3. Front Windshield Glare Risk Formula ($\text{GlareRisk}_i$)
$$\text{GlareRisk}_i = \left( 1 - \frac{|\phi_{\text{road}, i} - \phi_{\text{sun}, i}|}{45^\circ} \right) \times \left( 1 - \frac{\theta_{s, i}}{25^\circ} \right)$$

* **Conditions**: Evaluated when $|\phi_{\text{road}, i} - \phi_{\text{sun}, i}| \le 45^\circ$ and $0^\circ < \theta_{s, i} < 25^\circ$ (otherwise $\text{GlareRisk}_i = 0$)
* $\phi_{\text{road}, i}$: Vehicle Road Bearing / $\phi_{\text{sun}, i}$: Solar Azimuth Angle at $T_i$

---

## 🛠️ Tech Stack & Open APIs

| Category | Specifications |
| :--- | :--- |
| **Framework** | Ionic Capacitor 6 (Native Android Wrapper) |
| **Map Rendering** | Leaflet.js 1.9.4 (100% Local Bundled) |
| **Icons & Fonts** | FontAwesome 6 (Local WebFonts Asset Packaging) |
| **Routing Engine** | Open Source Routing Machine (`OSRM Driving API`) |
| **Speed Limit & Rules** | OpenStreetMap `Overpass API` (`maxspeed`, `highway=stop`) |
| **Place Search** | OSM `Nominatim` & `Photon Komoot API` |
| **Solar Calculations** | Astronomical AA+ Julian Day Formulas (`SunCalc.js`) |
| **Building / Terrain Occlusion** | OpenStreetMap `Overpass API` + OpenTopoData `ASTER30m` (bounded ray probes) |
| **Audio & TTS** | Capacitor Native TextToSpeech & Web Audio Synth |

---

## 💻 How to Build (Android APK)

To build the APK from source:

```bash
npm ci
npx @capacitor/cli sync android
cmd /c "build_apk.bat"
```

The compiled APK will be generated at **`SolarLessNavi_v1.0.apk`**.

Release builds require JDK 17, Android SDK/Gradle, and a signing keystore. Keep the keystore and passwords outside the repository and provide `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, and `RELEASE_KEY_PASSWORD` as user Gradle properties or environment variables. Without them the script fails; it never copies a debug APK as a release APK. For an unsigned functional check use `android\gradlew.bat assembleDebug`. Run `npm test` before building.

### Scope and limitations
* Routing depends on the free public OSRM service and may fail or be rate-limited.
* Search terms and location data may be sent to Nominatim, Photon, Overpass, and the selected map-tile providers (Esri/CARTO).
* Durations are OSRM geometry/step durations with a fixed time-of-day adjustment, not live traffic information. Moving the time slider reuses the geometry and refreshes solar analysis without another OSRM request.
* Buildings, tunnels, and terrain can adjust shade scores when optional OSM/DEM requests succeed. Routes expose heuristic, partial-scene, or precision-scene metadata; each role compares only within the same tier and falls back to heuristic when its scene data fails. These estimates do not guarantee shade, direct-sun reduction, temperature, or safety.
* Public OSRM, Overpass, OpenTopoData, Nominatim/Photon, and Esri/CARTO tile services can be rate-limited or unavailable. Attribution links are required by the providers' licenses and cannot be removed.

---

## 📜 Open Source & Data Credits

This project is built using the following open-source libraries and open data APIs:

* **Map Data & Road Network:** Map data © [OpenStreetMap](https://openstreetmap.org) contributors ([ODbL License](https://opendatacommons.org/licenses/odbl/))
* **Map Tile Providers:** [Esri World Street/Imagery](https://www.esri.com/en-us/arcgis/products/arcgis-online/overview) and [CARTO](https://carto.com/attributions) (follow each provider's attribution and usage terms)
* **Map Rendering Engine:** [Leaflet.js](https://leafletjs.com/) (BSD 2-Clause License)
* **Hybrid App Framework:** [Ionic Capacitor](https://capacitorjs.com/) (MIT License)
* **Icons & Web Fonts:** [FontAwesome 6](https://fontawesome.com/) (CC BY 4.0 / SIL OFL 1.1 / MIT License)
* **Place Search & Geocoding:** [Photon by Komoot](https://photon.komoot.io/) (Apache 2.0 License) & OSM Nominatim
* **Building / Tunnel Data:** [OpenStreetMap Overpass API](https://overpass-api.de/) (OSM data and ODbL terms apply)
* **Terrain Samples:** [OpenTopoData ASTER30m](https://www.opentopodata.org/datasets/aster/) public DEM API (subject to service limits and dataset resolution)
* **Solar Astronomical Calculations:** [SunCalc.js](https://github.com/mourner/suncalc) (BSD 2-Clause License)

---

## ⚖️ License (GNU AGPL-3.0)

This project is licensed under the **[GNU Affero General Public License v3.0 (GNU AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0)**.

* **Author**: **Hyeokjae Kwon, M.D., Ph.D. (권혁재 M.D., Ph.D.)** ([https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/))
* **Freedom to Use & Share**: You are free to run, study, modify, and distribute this software under the terms of the AGPL-3.0.
* **Strong Copyleft Requirement**: Any modifications, derivative works, or network/cloud-hosted services based on this project must also make their complete source code publicly available under the AGPL-3.0 license.
