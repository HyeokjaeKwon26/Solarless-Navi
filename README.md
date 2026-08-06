# ☀️ SolarLess Navi - 햇빛을 피하는 스마트 내비게이션 (Android)

[🇰🇷 한국어](#-solarless-navi---햇빛을-피하는-스마트-내비게이션-android) | [🇺🇸 English](#-solarless-navi---sun-glare--shade-aware-smart-navigation-android)

[![Platform](https://img.shields.io/badge/Platform-Android%208.0%2B-blue.svg?style=for-the-badge&logo=android)](https://developer.android.com)
[![Author](https://img.shields.io/badge/Author-권혁재%20M.D.%2C%20Ph.D.-orange.svg?style=for-the-badge)](https://hyeokjaekwon26.github.io/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)

> **"운전 중 눈을 찌르는 저녁 태양(역광)을 피하고 건물·지형 그림자의 시원한 그늘 길로 안내받으세요!"**
> 
> **SolarLess Navi**는 실시간 천문학 태양 위치(방위각/고도)와 OpenStreetMap 도로 벡터 연산을 통해 **① 건물 및 지형 그림자(그늘) 우선 경로**와 **② 정면 태양 눈부심(역광) 회피 경로**를 스마트하게 탐색하는 안드로이드 내비게이션입니다.

---

## 👨‍💻 개발자 정보 (Developer Information)
* **저작자 / 개발자**: **권혁재 M.D., Ph.D. (Hyeokjae Kwon, M.D., Ph.D.)**
* **공식 홈페이지**: [https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/)

---

## ✨ 핵심 듀얼 기능 (Core Dual Pillars)

### 🌲 1. 건물·구조물 그늘(Shadow) 우선 경로 안내
* **건물 및 지형 그림자 연산**: 실시간 태양 고도와 도로 방위각을 분석하여 건물 그림자, 산악 지형, 터널 구간을 정밀 연산합니다.
* **시원하고 쾌적한 주행**: 차 안으로 들어오는 강렬한 직사광선과 태양열을 차단하는 **시원한 그늘 도로를 우선 선택**하여 안내합니다.

### 🕶️ 2. 역광(눈부심) 회피 및 직사광선 차단 경로
* **NOAA AA+ 천문학 연산 기반**: 운전자의 GPS 위치와 주행 시각에 따른 태양 방위각(Azimuth) 및 고도각(Elevation)을 실시간 연산합니다.
* **전면 유리창 직사광선 차단**: 태양이 운전자의 정면 전면유리로 찌르는 서쪽 저녁 노을/아침 동쪽 태양 구간을 우회하는 안전 경로를 추천합니다.

### ☀️ 3. 실시간 자외선(UV) 감소율(%) 표시 & 4D 시공간 주행 예측
* **4D 시공간(Spatio-Temporal) 동적 태양광 연산**: 출발 시각 스냅샷이 아닌, 차량이 각 도로 세그먼트($i$)를 실제로 통과하는 미래 통과 시각($T_i = T_{\text{start}} + \Delta t_i$)의 태양 방위각/고도각을 구간별로 개별 연산하여 30분~1시간 이상 장거리 주행 시의 태양 이동(시간당 약 15°)을 완벽히 반영합니다.
* **일관된 표준 지표 실시간 표기**: 특정 경로로의 편향된 유도를 지양하고, **모든 경로 옵션 카드에 역광 위험도(%)와 자외선 감소율(%)을 일관된 표준 지표로 실시간 표기**합니다.
* **단일 경로/야간 자동 분기**: 대안 우회로가 없는 단일 최적 경로인 경우 해당 도로의 실제 그늘율/역광 지수를 표기하며, 일몰 후에는 `일몰 후 (자외선 0% 🌙)`로 자동 전환됩니다.
* **💡 자외선 절대량이 아닌 상대적 감축률(%) 산출 배경**: 차량 유리의 종류(전면 이중접합유리, 측면 강화유리, 파노라마 선루프) 및 썬팅(틴팅) 필름의 종류·농도에 따라 탑승자 피부에 도달하는 실제 자외선 흡수량은 차량마다 크게 달라집니다. 따라서 본 시스템은 특정 차량의 개별 썬팅 상태에 구애받지 않도록 **차량 창문으로 유입되는 자연 자외선 총량을 표준 기준치(Baseline)**로 두고, 최단 경로 대비 **"자외선 노출량이 얼마나 줄어드는지(감축률 %)"**를 객관적 비교 지표로 계산합니다.

### 🚥 4. 실시간 제한속도 & 전 세계 국가별 표지판 (한국/글로벌 🔴 / 미국 ⬜)
* OpenStreetMap `Overpass API`를 통해 전 세계 190여 개국 도로의 **실시간 제한속도 및 STOP 표지판**을 받아와 시각화합니다.
* **한국 및 유럽/아시아/글로벌 180개국 (비엔나 도로표지 협약 표준)**: 국제 규격 빨간색 원형 제한속도 표지판 (km/h)
* **미국 도로 (MUTCD 규격 표준)**: 흰색 사각형 표지판 (mph) & 8각 STOP 표지판 지원

### 🗣️ 5. 스마트 맞춤형 음성 안내 (TTS & 경고음)
* 경로 시작 시 자외선 감소 혜택에 맞추어 **`"자외선 노출을 42% 줄인 그늘 우선 경로로 안내를 시작합니다"`, `"자외선 노출을 35% 줄인 역광 회피 경로로 안내를 시작합니다"`, `"최단 시간 경로로 안내를 시작합니다"`**로 정확하게 동적 음성 안내합니다.
* 과속 및 200m 앞 강한 역광 위험 구간 진입 시 자동차 전용 2톤 경고음(Dong-Dong)을 재생합니다.

### ⚙️ 6. 스마트 주행 편의 기능 (Smart Convenience Features)
* **근처 5분 그늘 쉼터 / 주차장 원터치 경유지 탐색 (Shaded Rest Spot)**: 상단 헤더 원터치로 주변 그늘진 공원·주차장을 즉시 찾아 경유지로 추가하는 기능.
* **사용자 선호 경로 자동 기억 (Smart Preference Memory)**: 마지막 주행에서 선택한 경로 모드(최단/역광회피/그늘)를 기억하여 다음 주행 시 해당 모드를 기본 안내 경로로 자동 지정.
* **25초 자동 복귀 링 HUD (Auto-Recenter HUD)**: 주행 중 지도를 탐색하더라도 조작 중단 25초 후 차량 중심 위치로 부드럽게 자동 복귀.
* **100% 로컬 번들링 & 완전 오프라인 지원 (Zero External CDN Dependency)**: 모든 폰트, 아이콘, 지도 렌더러가 앱 내부에 번들링되어 인터넷 연결이 불안정한 환경에서도 100% 선명하고 즉각적으로 작동.
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

### 2. 자외선/직사광선 수신 감소율 연산 수식 ($\Delta E_{\text{UV}}$)
최단 경로 대비 추천 경로의 누적 자외선 수신 감소 비율:

$$\Delta E_{\text{UV}} = \left( 1 - \frac{\sum_{i \in \text{Alternative}} \sin(\theta_{s, i}) \cdot (1 - S_i \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_i) \cdot \Delta t_i}{\sum_{j \in \text{Fastest}} \sin(\theta_{s, j}) \cdot (1 - S_j \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_j) \cdot \Delta t_j} \right) \times 100$$

* $\text{Alternative}$ / $\text{Fastest}$: 추천 우회 경로 / 최단 기본 경로
* $\theta_{s, i}$: 구간 $i$ 통과 시점의 실시간 태양 고도각 (Solar Elevation Angle at $T_i$)
* $S_i$: 도로 구간 건물/지형 그늘 차광율 (Shade Coverage, $0.0 \sim 1.0$)
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
| **Audio & TTS** | Capacitor Native TextToSpeech & Web Audio Synth |

---

## 💻 소스코드 안드로이드 빌드 방법 (How to Build)

개발자가 소스코드를 직접 수정하여 APK를 빌드하려면 아래 명령어를 순서대로 실행하세요.

### 1. 의존성 설치 및 씽크
```bash
npm install
npx @capacitor/cli sync android
```

### 2. 안드로이드 APK 빌드 실행
```cmd
cmd /c "build_apk.bat"
```
빌드가 완료되면 루트 디렉토리에 **`SolarLessNavi_v1.0.apk`**가 생성됩니다.

---

## 📜 오픈소스 및 데이터 출처 고지 (Open Source Credits)

본 프로젝트는 아래의 오픈소스 프로젝트 및 오픈 API를 활용하여 개발되었습니다.

* **지도 데이터 및 경로 검색:** Map data © [OpenStreetMap](https://openstreetmap.org) contributors ([ODbL 라이선스](https://opendatacommons.org/licenses/odbl/) 준수)
* **지도 렌더링 엔진:** [Leaflet.js](https://leafletjs.com/) (BSD 2-Clause 라이선스)
* **하이브리드 앱 프레임워크:** [Ionic Capacitor](https://capacitorjs.com/) (MIT 라이선스)
* **아이콘 및 폰트:** [FontAwesome 6](https://fontawesome.com/) (CC BY 4.0 / SIL OFL 1.1 / MIT 라이선스)
* **위치 검색 API:** [Photon Komoot API](https://photon.komoot.io/) (Apache 2.0 라이선스) & OSM Nominatim
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

> **"Avoid blinding low-angle sun glare and drive under cool building & terrain shadows!"**
> 
> **SolarLess Navi** is a smart Android navigation application that calculates real-time astronomical solar positions (Azimuth & Elevation) and OpenStreetMap road vectors to route drivers along **① Shade-Priority Routes** and **② Glare-Free Avoidance Routes**.

---

## 👨‍💻 Developer Information
* **Author / Developer**: **Hyeokjae Kwon, M.D., Ph.D. (권혁재 M.D., Ph.D.)**
* **Official Website**: [https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/)

---

## ✨ Core Dual Pillars

### 🌲 1. Building & Terrain Shade-Priority Route Guidance
* **Shadow Computation**: Calculates real-time shadows cast by surrounding buildings, mountain terrain, and tunnels based on solar elevation and road bearings.
* **Cool & Comfortable Driving**: Directs drivers along shaded roads, reducing cabin heat and direct solar radiation.

### 🕶️ 2. Glare-Free Avoidance Route Guidance
* **NOAA AA+ Astronomical Calculations**: Computes exact solar azimuth and elevation angles in real time based on driver GPS coordinates.
* **Windshield Glare Protection**: Re-routes around roads heading directly into low-angle morning/evening sun glare.

### ☀️ 3. Real-Time Solar UV Exposure Reduction (%) & 4D Spatio-Temporal Simulation
* **4D Spatio-Temporal Solar Simulation**: Dynamically computes future solar azimuth and elevation angles for each road segment at its exact projected vehicle arrival timestamp ($T_i = T_{\text{start}} + \Delta t_i$), fully modeling solar trajectory changes (~15°/hr) during long-distance trips (30m - 1hr+).
* **Standardized Objective Metrics**: Displays **Glare Risk (%) and UV Reduction (%) consistently across all route cards** as standardized, neutral objective metrics without biased recommendation badges.
* **Single Route & Night Mode**: Displays intrinsic shade/glare metrics if no alternative detour exists, and automatically transitions to `Night (No UV 🌙)` after sunset.
* **💡 Rationale for Relative Reduction (%) vs. Absolute UV Dose**: The actual amount of UV radiation absorbed by an occupant's skin varies significantly depending on vehicle glass types (laminated front windshield vs. tempered side windows, sunroofs) and aftermarket window tinting films. To ensure objective, vehicle-agnostic guidance, SolarLess Navi establishes the incident solar UV radiation reaching vehicle windows as the **Standard Baseline**, and computes the **relative percentage reduction (%) in exposure** compared to the fastest baseline route rather than estimating uncertain absolute skin dosages.

### 🚥 4. Live Speed Limits & Global Road Signs (190+ Countries)
* Fetches live road speed limits & STOP signs via OpenStreetMap `Overpass API`.
* **International / Korea / Europe / Asia (180+ Countries, Vienna Convention Standard)**: International Red Circle Speed Limit Sign (km/h).
* **USA (MUTCD Standard)**: White Rectangular Speed Limit Sign (mph) & 8-sided STOP sign.

### 🗣️ 5. Smart Adaptive Voice Guidance (TTS & Warnings)
* Announces tailored navigation prompts reflecting UV benefits ("Starting guidance on Shade-Priority Route, reducing UV exposure by 42%", "Starting guidance on Glare-Free Avoidance Route, reducing UV exposure by 35%").
* Alerts driver with two-tone automotive chimes when approaching severe glare zones or exceeding speed limits.

### ⚙️ 6. Smart Convenience Features
* **One-Touch Shaded Rest Spot / Parking Finder**: Instantly locates nearby shaded parks, rest stops, and structures within a 5-minute radius and adds them as waypoints.
* **Smart Route Mode Memory**: Memorizes the driver's last selected route mode (Fastest, Glare-Free, Shade) and automatically sets it as the default for subsequent trips.
* **25s Auto-Recenter Ring HUD**: Automatically recenters the map to the vehicle position after 25 seconds of inactivity.
* **100% Local Asset Bundling (Zero External CDN Dependency)**: All fonts, icons, and map rendering engines are locally bundled into the APK for instant, offline-reliable rendering.
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

### 2. Cumulative UV Exposure Reduction Formula ($\Delta E_{\text{UV}}$)
$$\Delta E_{\text{UV}} = \left( 1 - \frac{\sum_{i \in \text{Alternative}} \sin(\theta_{s, i}) \cdot (1 - S_i \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_i) \cdot \Delta t_i}{\sum_{j \in \text{Fastest}} \sin(\theta_{s, j}) \cdot (1 - S_j \cdot 0.85) \cdot (0.35 + 0.65 \cdot \text{GlareRisk}_j) \cdot \Delta t_j} \right) \times 100$$

* $\text{Alternative}$ / $\text{Fastest}$: Recommended Alternative Route / Baseline Fastest Route
* $\theta_{s, i}$: Real-time Solar Elevation Angle at $T_i$
* $S_i$: Road segment building/terrain shade coverage ($0.0 \sim 1.0$)
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
| **Audio & TTS** | Capacitor Native TextToSpeech & Web Audio Synth |

---

## 💻 How to Build (Android APK)

To build the APK from source:

```bash
npm install
npx @capacitor/cli sync android
cmd /c "build_apk.bat"
```

The compiled APK will be generated at **`SolarLessNavi_v1.0.apk`**.

---

## 📜 Open Source & Data Credits

This project is built using the following open-source libraries and open data APIs:

* **Map Data & Road Network:** Map data © [OpenStreetMap](https://openstreetmap.org) contributors ([ODbL License](https://opendatacommons.org/licenses/odbl/))
* **Map Rendering Engine:** [Leaflet.js](https://leafletjs.com/) (BSD 2-Clause License)
* **Hybrid App Framework:** [Ionic Capacitor](https://capacitorjs.com/) (MIT License)
* **Icons & Web Fonts:** [FontAwesome 6](https://fontawesome.com/) (CC BY 4.0 / SIL OFL 1.1 / MIT License)
* **Place Search & Geocoding:** [Photon by Komoot](https://photon.komoot.io/) (Apache 2.0 License) & OSM Nominatim
* **Solar Astronomical Calculations:** [SunCalc.js](https://github.com/mourner/suncalc) (BSD 2-Clause License)

---

## ⚖️ License (GNU AGPL-3.0)

This project is licensed under the **[GNU Affero General Public License v3.0 (GNU AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0)**.

* **Author**: **Hyeokjae Kwon, M.D., Ph.D. (권혁재 M.D., Ph.D.)** ([https://hyeokjaekwon26.github.io/](https://hyeokjaekwon26.github.io/))
* **Freedom to Use & Share**: You are free to run, study, modify, and distribute this software under the terms of the AGPL-3.0.
* **Strong Copyleft Requirement**: Any modifications, derivative works, or network/cloud-hosted services based on this project must also make their complete source code publicly available under the AGPL-3.0 license.
