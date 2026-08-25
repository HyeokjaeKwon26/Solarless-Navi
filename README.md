# ☀️ SolarLess Navi

태양 위치, 도로 진행 방향, 건물·터널·지형을 함께 분석해 **빠른 경로**, **눈부심 회피 경로**, **그늘 우선 경로**를 비교하는 Android 중심의 실험적 내비게이션입니다.

[![Platform](https://img.shields.io/badge/Platform-Android-blue.svg?style=for-the-badge&logo=android)](https://developer.android.com)
[![Scene Data](https://img.shields.io/badge/Scene%20Data-USA%20%2B%20Korea-2ea44f.svg?style=for-the-badge)](#사전계산-장면-데이터)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)

> 이 앱의 일사·그늘·눈부심 수치는 공개 데이터와 수학 모델로 계산한 **실험용 추정값**입니다. 실제 자외선 선량, 차량 실내온도, 냉방 에너지, 의학적 보호효과 또는 안전을 측정하거나 보장하지 않습니다. 현장 표지, 교통법규, 기상·도로 상황과 운전자의 판단을 항상 우선하세요.

## 주요 기능

- **빠른 경로**: OSRM 후보 중 기본 예상시간이 가장 짧은 실제 도로 경로입니다.
- **눈부심 회피 경로**: 예상 통과시각의 태양 방향·고도, 차량 진행방향, 직접 일사와 차광을 이용해 전방 눈부심을 비교합니다.
- **그늘 우선 경로**: OSM 건물·터널과 SRTM/DEM 지형 단면이 태양 광선을 차단하는지 2.5D로 계산하고, 직사광선 노출 예상시간이 가장 짧은 유의미한 대안을 우선합니다.
- **빠른 초기 결과**: 공통 휴리스틱 결과를 먼저 표시한 뒤, 필요한 장면 타일이 준비되면 같은 분석 등급끼리 다시 비교합니다.
- **자동차용 안내**: 주소 우선 검색, 자동차 도로에 맞춘 목적지, 음성 회전 안내, 이탈 재탐색, heading-up, 자동 재중앙 정렬과 선택형 PiP를 제공합니다.
- **부분 실패 보존**: 장면 API나 타일 일부가 실패해도 OSRM 도로 경로는 유지하며, 정밀값과 휴리스틱값을 조용히 섞지 않습니다.

## 계산 흐름

```text
OSRM 도로 후보
  → 모든 후보를 같은 경량 모델로 예비 분석
  → 빠른 경로와 목적별 유력 후보 선정
  → 필요한 5 km 장면 타일만 다운로드·로컬 캐시
  → Open-Meteo 기상예보와 건물·터널·지형 차광을 순차 계산
  → 같은 분석 등급 안에서 직사광선 노출시간·총 직접 일사 에너지·눈부심 비교
```

OSRM의 `duration`은 교통 프로필 기반 기본 예상시간이며 실시간 교통정보가 아닙니다. 앱은 근거가 없던 임의의 시간대 배율을 더 이상 적용하지 않습니다.

## 과학 모델과 수식

### 1. 구간 통과시각

OSRM step 시간이 있으면 그 시간을 전체 주행시간에 맞춰 배분하고, 그렇지 않으면 누적거리 비율로 구간 `i`의 통과시각 `T_i`를 정합니다.

$$T_i=T_0+\frac{t_i}{\sum_j t_j}T_{route}$$

### 2. 태양 위치: NREL SPA

위도·경도·고도·기압·기온·UTC 시각으로 NREL Solar Position Algorithm(SPA)의 태양 천정각 `z_i`와 방위각 `A_i`를 계산합니다. 정밀 장면에 가까운 DEM 표본이 있으면 그 고도로 기압을 보정하고, 장면이 없으면 해수면 표준대기 가정을 사용합니다. 구현은 NREL의 공개 기준 사례와 회귀 테스트로 검증합니다.

- Reda & Andreas, [Solar Position Algorithm for Solar Radiation Applications](https://doi.org/10.2172/15003974)
- NREL [SPA 자료와 원본 구현](https://midcdmz.nrel.gov/spa/)

### 3. 맑은하늘 일사: Bird 모델

Bird clear-sky 모델로 직접법선일사 `DNI_i`, 산란수평일사 `DHI_i`, 전천수평일사 `GHI_i`의 맑은하늘 기준값을 추정합니다. 경로를 즉시 표시하는 1차 계산과 기상예보를 사용할 수 없는 경우에는 다음 표준 대기 가정을 사용합니다.

| 입력 | 기본값 |
|:--|--:|
| 오존량 | 0.30 cm |
| 가강수량 | 1.5 cm |
| 에어로졸 광학두께 | 0.10 at 380 nm, 0.08 at 500 nm |
| 지표 알베도 | 0.20 |

직접수평일사는 다음과 같습니다.

$$I_{dir,i}=DNI_i\max(0,\cos z_i)$$

- Bird & Hulstrom, [A Simplified Clear Sky Model](https://doi.org/10.2172/6510849)

### 3-1. 기상예보 직접일사 보정

백그라운드 보정에서는 경로를 약 10 km 또는 15분 통과 간격으로 표본화하고 Open-Meteo의 15분별 `direct_normal_irradiance`, `direct_radiation`, `diffuse_radiation`, `shortwave_radiation`과 시간별 운량을 조회합니다. 겹치는 경로의 위치 셀은 한 번만 조회하고, 각 구간의 예상 통과시각에 선형 보간합니다. 예보가 완전히 확보된 비교 후보에만 같은 기상 등급을 적용합니다.

예보 범위 밖의 날짜, 응답 누락, 시간초과 또는 네트워크 장애에서는 모든 후보가 Bird 맑은하늘 기준으로 함께 돌아갑니다. 일부 구간만 예보값을 쓰고 나머지를 맑은하늘 값으로 채워 한 점수에 섞지 않습니다. 성공 예보는 25분, 실패 결과는 약 90초만 메모리에 보관하며 취소된 요청은 캐시에 남기지 않습니다.

이 예보는 미래의 실제 구름을 확정하는 관측값이 아니며 연기, 국지 안개, 건물 주변 미기후와 급격한 구름 변화가 다를 수 있습니다. 사용 시점의 모델·공간격자·발행시각에 따른 불확실성이 있습니다.

- Open-Meteo [Weather Forecast API](https://open-meteo.com/en/docs)
- Open-Meteo [요금·이용 조건](https://open-meteo.com/en/pricing)

### 4. 건물·지형·터널 차광

태양을 향한 광선이 OSM 건물의 2.5D 높이, DEM 지형 단면 또는 터널과 교차하는지 검사합니다. v3 장면에서는 오차 범위 전체에서도 결론이 바뀌지 않을 때만 `O_i=1`(확정 차광) 또는 `O_i=0`(확정 맑음)으로 둡니다. 높이·지형 오차에 따라 결론이 달라지면 `O_i=?`로 남기며, 그 구간에는 차광 이득을 부여하지 않습니다.

$$O_i=\begin{cases}1,&\text{오차 하한에서도 직달광 차단}\cr0,&\text{오차 상한에서도 차단 없음}\cr?,&\text{오차 범위에 따라 결론이 바뀜}\end{cases}$$

건물 높이는 OSM `height`를 우선합니다. `building:levels`만 있으면 층당 3.2m를 중심값으로 사용하되 3.0–4.5m/층 범위를 함께 검사합니다. 두 태그가 모두 없으면 6m를 중심값으로 두고 3–12m 민감도 범위를 검사합니다. `min_height` 또는 `building:min_level`이 있는 떠 있는 `building:part`는 그 아래 열린 공간을 차광물로 채우지 않고, 태양 광선이 가능한 하단과 상단 사이를 통과할 때만 차광 후보로 봅니다. 이 범위는 통계적 신뢰구간이 아니라 건물 용도·층고 차이를 보수적으로 드러내는 설계 범위입니다. OSM 자체에 건물이 없거나 way가 아닌 복잡한 multipolygon relation으로만 존재하면 현재 전처리에서 누락될 수 있습니다.

지형은 SRTM 1 arc-second 표본과 방향별 지평선 프로필을 사용합니다. NASADEM/SRTM의 상대 수직오차 지침을 따라 v3 장면에서는 ±10m(90% 수준) 범위를 검사합니다. 지형 광선 여유가 +10m보다 크면 확정 차광, -10m보다 작으면 확정 맑음, 그 사이는 불확실로 표시합니다. 수목, 공사, 교량, 옥상 형상, DEM 수평 해상도와 OSM 태그 정확도는 여전히 모델 밖 불확실성입니다.

- OpenStreetMap [`building:levels`](https://wiki.openstreetmap.org/wiki/Key%3Abuilding%3Alevels)
- NASA LP DAAC [NASADEM User Guide](https://lpdaac.usgs.gov/documents/592/NASADEM_User_Guide_V1.pdf)
- Usui, [건물 용도별 층고 차이](https://doi.org/10.1177/23998083221116117)
- Bocher et al., [GeoClimate의 누락 건물높이 추정 논의](https://doi.org/10.5194/gmd-15-7505-2022)

### 5. 직사광선 노출시간과 총 직접 일사 에너지

태양이 지평선 위에 있고 예보 또는 Bird 기준 `DNI_i`가 120 W/m² 이상이며 건물·지형·터널에 의해 확정 차광되지 않았다면 그 구간의 시간을 직사광선 노출 예상시간에 더합니다. 데이터가 없거나 차광 판정이 불확실한 구간은 그늘을 만들어내지 않도록 보수적으로 노출시간에 포함합니다. 120 W/m²는 일조시간 판정에 쓰이는 복사 기준이며 의학적 보호 임계값이 아닙니다.

$$T_{sun}=\sum_i \mathbf{1}\!\left[\alpha_i>0\land DNI_i\ge120\land O_i\ne1\right]\Delta t_i$$

그늘 우선 경로는 허용 가능한 우회 후보 중 `T_sun`이 가장 짧은 경로를 먼저 선택합니다. 노출시간 차이가 30초 이내이면 구간 표본·시간 매핑의 작은 차이로 보아, **거리 평균이 아닌 시간 적분 직접 일사 에너지**가 더 낮은 경로를 선택합니다. 두 값도 같으면 주행시간이 짧은 경로를 사용합니다. 30초 기준은 의학적 임계값이 아니라 불필요한 우회를 막기 위한 제품상 잡음 방지 기준입니다.

$$H_{dir}=\sum_i I_{dir,i}(1-O_i)\frac{\Delta t_i}{3600}\quad[Wh/m^2]$$

태양이 머리 위에 있어 전방 눈부심이 낮더라도 차광물이 없으면 `T_sun`과 `H_dir`에 모두 반영됩니다. 반대로 터널이나 건물·산이 직달광을 막으면 해당 구간은 노출시간에서 제외되고 직접 에너지 성분도 0이 됩니다. 산란광은 별도로 적분하지만 그늘 경로 선정에는 직접 성분만 사용합니다.

대안 경로 감소율은 같은 분석 등급의 빠른 경로를 기준으로 합니다.

$$R=100\left(1-\frac{H_{candidate}}{H_{fastest}}\right)$$

노출시간이 유의미하게 짧은 경로가 우선이며, 노출시간이 사실상 같을 때 누적 에너지가 더 큰 우회 경로는 선택하지 않습니다. 최대 우회비율과 최소 개선 기준도 계속 적용하므로 서로 다른 경로를 만들기 위해 열등한 대안을 억지로 추천하지 않습니다.

### 6. 눈부심

진행방향과 태양방향의 각도차를 `θ_i`라 하고, 운전자 눈 위치에서의 조도를 `E_eye`로 근사해 CIE/Stiles–Holladay disability-glare 등가 휘도를 계산합니다.

$$L_{veil}=\frac{10E_{eye}}{\theta_i^2}$$

화면의 0–1 값은 `L_veil`을 표시하기 쉽게 정규화한 실험용 지표이지 사고확률이나 의학적 위험확률이 아닙니다. 태양이 장면에 의해 차단되면 직접 눈부심 성분은 제거합니다.

- CIE, [CIE 146:2002 Collection on Glare](https://www.cie.co.at/publications/cie-collection-glare-2002)

### 7. UV와 냉방 에너지에 관한 정직한 범위

현재 Bird 계산은 광대역 맑은하늘 일사이며 **UV Index나 홍반가중 UV 선량이 아닙니다**. 실제 UV 선량에는 파장별 복사량, 홍반 작용스펙트럼, 구름·에어로졸, 차량 유리 투과율과 피부 노출형상이 필요합니다. 그늘에서도 산란 UV가 남습니다.

- WHO, [Global Solar UV Index: A Practical Guide](https://www.who.int/publications/i/item/9241590076)

차광으로 피한 `Wh/m²`를 차량 냉방 전력으로 바꾸려면 유리 면적·각도·투과율, 차체 흡수율, 외기온, 환기, 탑승자, HVAC 제어와 COP가 필요합니다. 앱은 실내온도나 냉방 절감량을 표시하지 않습니다. 연구 보고서에서는 효과적 결합면적 1.5–3.0 m², 결합률 0.35–0.65, COP 2.0–3.5를 둔 **민감도 범위**만 별도로 제시합니다.

- Fayazbakhsh & Bahrami, [Comprehensive Modeling of Vehicle Air Conditioning Loads](https://doi.org/10.4271/2011-01-0127)
- NREL, [Vehicle Ancillary Load Reduction Project](https://www.nrel.gov/docs/fy07osti/40986.pdf)

## 분석 등급

| 표시 | 의미 |
|:--|:--|
| **정밀 장면** | 비교 후보에 필요한 건물·터널·지형 자료가 확보되어 2.5D 광선 교차를 계산함 |
| **부분 장면** | 확보된 구간만 장면 차광을 적용하고 미확인 구간에는 차광 이득을 만들지 않음 |
| **차광 불확실** | 건물 높이 또는 DEM 오차 범위에 따라 광선 차단 결론이 바뀌는 구간. 보수적으로 노출 구간으로 계산함 |
| **휴리스틱** | 장면을 사용할 수 없어 태양·도로 방향의 가능성만 계산하며 실제 그늘로 확정하지 않음 |
| **야간** | 태양이 지평선 아래라 직접 일사가 0이며 장면 다운로드를 생략함 |

서로 다른 분석 등급의 수치를 한 경로 순위에 섞지 않습니다. 빠른 경로 기준 장면이 없으면 목적 경로도 공통 휴리스틱으로 비교합니다.

ETA는 OSRM step별 소요시간을 경로 geometry에 대응시켜 남은 구간만 합산합니다. Web Geolocation의 `accuracy`는 W3C 정의의 약 95% 수평 위치 반경, Android `Location.getAccuracy()`는 플랫폼 정의에 따라 약 68% 수평 반경으로 구분해 **위치오차만으로 생기는 ETA 영향**을 별도 계산합니다. 이는 교통·신호·OSRM 모델 오차를 포함한 전체 ETA 신뢰구간이 아닙니다.

## 미국 전역 시뮬레이션

[미국 단·중·장거리 맑은하늘 경로 시뮬레이션 보고서](docs/US_SOLAR_ROUTE_SIMULATION.md)는 미국 4개 권역에서 12개 OD와 네 출발시각, 총 48개 사례를 재현한 2026-08-21 기준 스냅샷입니다. 이 실험은 이전의 누적 직접 일사 우선 정책으로 생성되었으므로, 아래 감소율은 현재의 직사광선 노출시간 우선 정책 결과로 해석하면 안 됩니다.

- 48/48 사례에서 장면 또는 부분 장면 분석 완료
- 전체 주행시간 중 평균 모델 확정 차광시간 비율: **6.0%**
- 당시 OSRM 후보와 누적 직접 일사 우선 기준에서 선택된 그늘 경로의 추가 직접 일사 감소: **0.0%**
- 이는 “그늘이 없었다”가 아니라, 제한된 후보 중 총 누적 일사를 더 줄이는 합리적 대안이 없었다는 뜻입니다.
- 실제 UV 선량·실내온도·연료/배터리 절감으로 변환하지 않았습니다.

CSV, JSON과 SVG 그래프도 보고서와 함께 저장됩니다. 재현 명령은 `npm run simulate:us`입니다.

## 사전계산 장면 데이터

미국과 한국 경로에서는 필요한 5 km 타일만 GitHub Release에서 받아 기기에 캐시합니다. 경로가 권역 경계를 지나면 여러 manifest를 병합합니다. ZIP 전체를 객체로 유지하지 않고 필요한 JSON 항목만 선택적으로 해제·파싱합니다.

| 권역 | 5 km 타일 | ZIP 자산 | Release |
|:--|--:|--:|:--|
| 미국 Northeast | 15,421 | 766 | [v3](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-northeast-hybrid-v3) |
| 미국 Midwest | 43,707 | 899 | [v3](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-midwest-hybrid-v3) |
| 미국 South | 47,566 | 899 | [v3](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-south-hybrid-v3) |
| 미국 West | 41,802 | 899 | [v3](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-west-hybrid-v3) |
| 대한민국 | 3,961 | 158 | [v3](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-kr-hybrid-v3) |

공개 manifest와 Release 자산은 모두 schema v3입니다. v3는 건물 높이 출처와 민감도 범위, 지형의 상대 수직오차 범위를 보존하며 경계가 불확실한 차광에는 이득을 부여하지 않습니다.

## 외부 서비스와 개인정보

위치, 경로 좌표 또는 검색어가 기능에 따라 아래 서비스로 전송될 수 있습니다.

| 목적 | 서비스 |
|:--|:--|
| 도로 경로 | OSRM |
| 주소·장소·국가 | Nominatim, Photon |
| 장면 fallback | OSM Overpass, OpenTopoData |
| 지도 | CARTO Voyager, OpenStreetMap contributors |
| 사전계산 장면 | GitHub Releases |
| 기상예보·직접일사 | Open-Meteo |

공개 서비스는 장애·속도제한·정책 변경이 있을 수 있습니다. 다운로드한 장면은 재사용하지만 새 도로 경로의 오프라인 계산은 지원하지 않습니다.

## 개발·검증·빌드

Node.js 20+, JDK 17, Android SDK/Android Studio와 저장소의 Gradle Wrapper가 필요합니다.

```bash
npm ci
npm test
npm run simulate:us
npx @capacitor/cli sync android
```

Debug APK:

```cmd
android\gradlew.bat assembleDebug
```

서명된 release는 저장소 밖의 `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`를 사용합니다. 선택적으로 `EXPECTED_SIGNING_CERT_SHA256`으로 인증서 고정을 검증할 수 있습니다.

## 면책조항

SolarLess Navi는 연구·연습 목적의 실험용 소프트웨어입니다. 데이터 누락·오류·노후화, 모델 오차, GPS 오차, 네트워크 장애와 플랫폼 제한이 존재합니다. 앱이 제시한 경로·속도·STOP·그늘·눈부심·도착시간은 법적 또는 안전상 판단을 대체하지 않습니다. 운전 중 화면 조작이나 수치 확인으로 주의를 분산시키지 마십시오. 건강, 피부, 안과, 열질환 또는 에너지 절감에 관한 결정을 위해 이 앱의 값을 단독 사용하지 마십시오.

## 기술·라이선스

- 앱: AGPL-3.0-only
- Android: Capacitor 6
- 지도: Leaflet, CARTO Voyager, © OpenStreetMap contributors
- 도로·건물·터널: OpenStreetMap ODbL
- 태양 위치: `nrel-spa`와 NREL SPA — 자세한 조건은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- 지형: SRTM 및 fallback ASTER30m
- 기상예보: Open-Meteo Forecast API — 공급자 표시와 이용 조건은 해당 서비스 정책을 따름

## 개발자

**Hyeokjae Kwon, M.D., Ph.D.**<br>
[Website](https://hyeokjaekwon26.github.io/) · [GitHub](https://github.com/HyeokjaeKwon26)

---

<details>
<summary><strong>English documentation</strong></summary>

## SolarLess Navi

SolarLess Navi is an experimental Android-focused navigation app that compares the fastest, glare-avoidance and shade-priority routes using road geometry, solar position, buildings, tunnels and terrain.

### Scientific calculation

1. **Time mapping:** OSRM step durations are scaled to the route duration to estimate each segment pass time.
2. **Solar position:** NREL SPA computes zenith and azimuth ([Reda & Andreas](https://doi.org/10.2172/15003974)).
3. **Clear-sky irradiance and weather:** the Bird model provides the immediate clear-sky baseline ([Bird & Hulstrom](https://doi.org/10.2172/6510849)). Background refinement samples the route at approximately 10 km or 15-minute intervals and obtains 15-minute DNI/direct/diffuse/shortwave radiation plus hourly cloud cover from the [Open-Meteo Forecast API](https://open-meteo.com/en/docs). Overlapping route cells share requests. Forecast values are interpolated to segment pass times. Forecasts are predictions rather than observations and may miss smoke, fog, rapid cloud changes and street-scale microclimate.
4. **Occlusion and uncertainty:** a sun ray is tested against 2.5D OSM buildings, tunnels and SRTM terrain profiles. A v3 scene confirms shade only when the obstruction remains under the lower height/elevation bound. `building:levels` uses 3.2 m/storey with a 3.0–4.5 m sensitivity envelope; missing heights use 6 m with a 3–12 m envelope. `min_height` and `building:min_level` preserve the open space below floating building parts. Terrain uses a ±10 m relative vertical-error test derived from the NASADEM/SRTM 90% guidance. DEM elevation also supplies the pressure correction used by SPA/Bird when a nearby sample exists. A marginal result is marked uncertain and receives no shade credit. These envelopes are sensitivity bounds, not statistical confidence intervals. Missing buildings, way-only preprocessing of complex multipolygon relations, trees and finite horizontal resolution remain limitations ([NASADEM guide](https://lpdaac.usgs.gov/documents/592/NASADEM_User_Guide_V1.pdf), [Usui](https://doi.org/10.1177/23998083221116117), [GeoClimate](https://doi.org/10.5194/gmd-15-7505-2022)).
5. **Direct-sun duration and energy integration:** a segment contributes to expected direct-sun duration when the sun is above the horizon, forecast or Bird DNI is at least 120 W/m², and scene data does not confirm occlusion. Missing or uncertain occlusion is conservatively counted as exposed:

$$T_{sun}=\sum_i \mathbf{1}[\alpha_i>0\land DNI_i\ge120\land O_i\ne1]\Delta t_i.$$

The shade-priority route first minimizes `T_sun` among alternatives that pass the detour and minimum-benefit guards. When two routes are within 30 seconds, the app uses time-integrated direct horizontal energy as the tie-breaker,

$$H_{dir}=\sum_i DNI_i\max(0,\cos z_i)(1-O_i)\frac{\Delta t_i}{3600}.$$

and then uses driving duration if both exposure measures are tied. The 30-second band is a product noise guard, not a medical threshold. Overhead sun therefore still counts as direct exposure when no building, terrain or tunnel blocks it; glare remains a separate directional metric.

Forecast coverage is all-or-nothing for a comparison tier. If a candidate lacks the required weather interval, every compared route falls back to the common Bird clear-sky tier. Successful forecasts are cached for 25 minutes, failures for about 90 seconds, and aborted requests are not cached. Diffuse irradiance is integrated separately and is not removed by building shade because the app does not model sky-view factor. Open-Meteo attribution and usage conditions apply; see its [pricing and licence information](https://open-meteo.com/en/pricing).

6. **Disability glare:** the direct component follows the CIE/Stiles–Holladay veiling-luminance relation `Lveil = 10 Eeye / θ²` ([CIE 146:2002](https://www.cie.co.at/publications/cie-collection-glare-2002)). The displayed normalized score is not a crash or medical-risk probability.

Remaining ETA follows OSRM step timing rather than a linear distance ratio. The app separately propagates Web Geolocation accuracy (approximately 95% horizontal radius) or Android native location accuracy (approximately 68% horizontal radius) into a GPS-position-only ETA effect. It is not a full traffic or arrival-time confidence interval ([W3C Geolocation](https://www.w3.org/TR/geolocation/), [Android Location](https://developer.android.com/reference/android/location/Location#getAccuracy())).

### What the values do not mean

The model does **not** calculate UV Index or erythemal UV dose. Spectral irradiance, action-spectrum weighting, clouds, glazing and occupant geometry would be required; diffuse UV also remains in shade ([WHO UVI guide](https://www.who.int/publications/i/item/9241590076)). It does not calculate cabin temperature or actual HVAC/fuel/battery savings. Those require a vehicle heat-balance model, glazing/body properties, weather and HVAC control ([SAE 2011-01-0127](https://doi.org/10.4271/2011-01-0127)).

### Reproducible U.S. simulation

The [research-style report](docs/US_SOLAR_ROUTE_SIMULATION.md) is a 2026-08-21 snapshot of 12 U.S. short/medium/long OD pairs at four local departure times (48 cases). It used the previous integrated-energy-first policy, not the current direct-sun-duration-first selector. Scene or hybrid-scene analysis completed in every case and found a 6.0% mean confirmed shade-time share over total driving time, but that historical run selected no alternative with lower total direct energy than the fastest route among the limited OSRM candidates. This negative result is reported as-is; it is not converted into a UV, temperature or energy-saving claim. The public manifests and Release assets use schema v3 uncertainty envelopes.

### Safety disclaimer

This is research software. Estimates can be wrong because map, height, terrain, weather, route, GPS or network data can be missing or stale. It does not provide medical protection or replace signs, traffic law, weather/road conditions, or driver judgment. Do not interact with the display while driving.

### Build

Use Node.js 20+, JDK 17 and the Android SDK. Run `npm ci`, `npm test`, then `npx @capacitor/cli sync android`. Release credentials must remain outside the repository.

</details>
