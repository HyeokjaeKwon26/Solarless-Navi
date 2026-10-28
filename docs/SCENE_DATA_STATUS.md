# 지도 장면 데이터 현황

다음 OSM 갱신 때 사용할 기준표다. 아래 현황은 **2026-10-28 05:58 UTC**에 저장소 manifest와 공개 릴리스를 확인해 작성했다. 이 확인은 현재 시점의 최신 OSM을 다시 내려받아 비교한 것은 아니다.

| 권역 | 현재 지도에 사용한 OSM 추출 기준 시각 (UTC) | 현재 릴리스 공개 시각 (UTC) | 현재 릴리스와 manifest |
|:--|:--|:--|:--|
| 대한민국 | 2026-10-26 21:24:46 | 2026-10-28 00:43:29 | [Release](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-kr-hybrid-v3-osm-20261026-r2) · [manifest](../data/scene/kr/manifest.json) |
| 미국 Northeast | 2026-10-27 21:23:59 | 2026-10-28 05:56:27 | [Release](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-northeast-hybrid-v3-osm-20261027-multipolygon-recheck-20261028-followup-20261028-rings-20261028) · [manifest](../data/scene/us-northeast/manifest.json) |
| 미국 Midwest | 2026-10-27 21:23:59 | 2026-10-28 05:56:52 | [Release](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-midwest-hybrid-v3-osm-20261027-multipolygon-recheck-20261028-followup-20261028-rings-20261028) · [manifest](../data/scene/us-midwest/manifest.json) |
| 미국 South | 2026-10-27 21:23:59 | 2026-10-28 05:49:07 | [Release](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-south-hybrid-v3-osm-20261027-multipolygon-recheck-20261028-followup-20261028) · [manifest](../data/scene/us-south/manifest.json) |
| 미국 West | 2026-10-27 21:23:59 | 2026-10-28 05:48:32 | [Release](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/scene-us-west-hybrid-v3-osm-20261027-multipolygon-recheck-20261028-followup-20261028) · [manifest](../data/scene/us-west/manifest.json) |

**OSM 추출 시각과 공개 시각은 다르다.** 추출 기준 시각은 원본 PBF에 반영된 OSM 변경의 기준이며, 공개 시각은 그 원본으로 만든 지도 파일의 GitHub Release 공개 시각이다. 미국의 10월 28일 multipolygon 추가 검토는 같은 10월 27일 추출본을 사용했으므로 OSM 원본 자체가 10월 28일까지 갱신된 것은 아니다. 각 원본 PBF의 SHA-256은 해당 manifest의 `osmPbfSha256`에 있다.

기존 SRTM 지형 격자는 유지했다. 신규 타일 및 신규·변경 건물의 지면 고도에는 Mapzen Terrain Tiles Skadi를 사용한 경우가 있다. 건물 높이 태그가 없는 경우에는 추정 범위를 사용하므로 OSM 날짜가 최신이어도 높이의 실측 정확도가 보장되지는 않는다.

## 남은 검토와 근거

- 한국 갱신·경로 비교: [한국 장면 데이터 점검](SCENE_DATA_AUDIT_2026-10-27.md).
- 미국 네 권역 갱신·경로 비교: [미국 장면 데이터 갱신](US_SCENE_UPDATE_2026-10-27.md).
- 미국 multipolygon 후속 확인: [472개 후속 검토](US_MULTIPOLYGON_REMAINING_472_2026-10-28.md). 이 단계에서 5개 관계의 **일부** 형상을 추가했고, 467개 관계에는 그 단계에서 새 형상을 추가하지 못했다. 467개가 전체 미해결 수를 뜻하지는 않는다. 이전 단계에서 일부만 반영한 관계도 남아 있다. 상세 ID와 사유는 각 보고서의 목록을 확인한다.
- 릴리스 자산 의존성: Northeast와 Midwest는 현재 릴리스와 이전 네 릴리스, South와 West는 현재 릴리스와 이전 세 릴리스의 ZIP을 함께 참조한다. 각 manifest의 `packaging.baselineReleaseTags`와 `packs`를 확인해 참조되는 릴리스를 유지한다.

## 다음 확인 또는 갱신 때 기록할 항목

1. 확인 날짜와 시간대, 대상 권역, 기존 manifest의 릴리스 태그와 원본 PBF 기준 시각·SHA-256.
2. 새로 확인한 OSM 추출본의 기준 시각·SHA-256과 비교 범위. 건물·터널 way, 신규 객체, 외곽선, multipolygon 중 실제로 확인한 범위를 구분한다.
3. 갱신 여부와 공개한 릴리스 태그·공개 시각. 변경이 없어 갱신하지 않았으면 그 사실과 확인 범위를 기록한다.
4. 반영·제외·부분 반영의 수와 ID별 사유, 이전 미해결 항목의 처리 결과. 평면 외곽선이 이미 있는 것과 높이까지 일치하는 것은 구분한다.
5. 동일 조건의 경로별 그늘 비교 결과, 지도 적용률, 지면 고도 출처, 자산 체크섬과 참조 릴리스의 검증 결과. 확인하지 않은 항목은 미확인으로 남긴다.

확인 결과가 확정되면 이 표를 현재 상태로 갱신하고, 상세 비교와 이전 상태는 날짜가 있는 별도 보고서에 보존한다.
