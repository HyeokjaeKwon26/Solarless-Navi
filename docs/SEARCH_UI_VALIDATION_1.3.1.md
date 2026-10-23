# 1.3.1 주소 검색·모바일 설정 수정 검증

버전: 1.3.1 / Android versionCode 5. 기존 정식 릴리스 서명키 유지.

## 변경

- 번호로 시작하는 도로 주소는 번지와 도로명 일치를 확인한 후보만 표시한다. 도로 약어를 확장하고 지역 한정어 및 제공된 ISO 지역 코드를 확인한다.
- 실제 Photon 응답에서 사진의 엉뚱한 버스 정류장·주차장·다른 도로를 재현했다. 수정된 Geocoder의 실제 `94 gerry rd` 조회에서는 Boston 기준 Brookline의 94 Gerry Road를 첫 후보, Lynnfield의 동명 주소를 다음 후보로 반환했다. 이는 사용자의 의도한 주소를 추측해서 확정했다는 의미가 아니다.
- 목적지 입력 후 돋보기/Enter/하단 검색은 주소 목록을 보여준다. 사용자가 전체 주소를 고르기 전에는 첫 결과로 경로를 시작하지 않는다. 도시·주·우편번호를 줄임 없이 표시하고 출발지가 있으면 거리를 보여준다.
- 입력 변경·Escape·목록 바깥 클릭 시 오래된 자동완성 요청과 후보를 취소한다. 취소된 요청은 빈 결과를 캐시에 남기지 않는다.
- ‘지도 / Map’ 버튼을 제거했다. 기존 상단 설정 버튼이 검색 화면을 닫고 설정을 연다.
- 설명 영역은 줄바꿈하고 토글은 44px 폭을 유지해 Free drive의 긴 영문 설명 때문에 스위치가 줄어들거나 손잡이가 밖으로 나가지 않게 한다.

## 검증

- Node: 231개 통과. 잘못된 번지·도로, 지역과 도로 혼동, Photon의 번지 표시, 지역 한정어, 미국 주 약어, 취소 후 재검색을 포함한다.
- 브라우저: root와 APK용 www에서 총 44개 통과(기존 38개 + 새 6개). 주소 검색/명시적 선택, Enter/버튼/출발지 검색, 320·360·384·412px 설정 화면에서 토글 켜짐/꺼짐 및 손잡이 경계를 확인한다.
- Android: JVM 테스트 11개 및 debug 빌드/lint 통과. 네이티브 코드는 변경하지 않았다. 최종 서명 APK는 GitHub release workflow가 동일 소스의 모든 검증을 다시 수행한 뒤 생성한다.
- root/www 50개 자산 SHA-256 일치. npm audit 취약점 0개.
- 공개 서비스 검색 결과는 시점·데이터·위치에 따라 달라질 수 있다. 지도 데이터에 없는 주소를 다른 장소로 대체하지 않는다.

## 실제 폰 확인 항목

1. 1.3.0 정식 앱에서 업데이트 확인 → 다운로드 → 설치. 앱 삭제 없이 설정/즐겨찾기가 유지되는지 확인.
2. `94 gerry rd` 입력 후 돋보기 → 도시/주/우편번호 확인 → 의도한 후보 선택. 키보드를 열어 둔 채 결과 스크롤 및 선택 확인.
3. 설정에서 Free drive 스위치를 켜고 끄고, Android 글자/화면 크기를 키워도 설명과 스위치가 겹치지 않는지 확인.

연결된 실제 폰과 실제 주행으로 확인한 항목은 없다. 이번 수정 범위는 주소 검색과 설정 레이아웃이다.

## 검색 서비스

기존 Nominatim 연동은 명시적인 검색에서만 사용하며 타이핑 자동완성에는 호출하지 않는다. [Nominatim 사용 정책](https://operations.osmfoundation.org/policies/nominatim/)은 자동완성 금지와 앱 전체 요청량 제한을 둔다. [Photon](https://github.com/komoot/photon)은 자동완성을 지원하지만 공개 서버의 결과 품질/가용성은 보장되지 않는다.

## 공개 배포 확인

- 앱 소스 커밋: `bf8a05cd961df8fb7d1c80855d6cfb8d9af9d7de`
- [전체 CI 성공](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40023441740)
- [APK 검증 및 배포 성공](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40023441378)
- [1.3.1 릴리스](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/app-v1.3.1)
- 공개 APK 재다운로드 후 apksigner/aapt 검증 통과: `com.solaris.nav`, 1.3.1/code 5, non-debuggable, 4,377,764 bytes.
- 인증서 SHA-256: `59ea18b8ee971936d9e9780a57c4d4594b0c3b9ddbbc6318d1ba6559111f6977`
- APK SHA-256: `bff3be8d8c67f8a68ae6e7c0a64053d33118151c26f404da2de130d0f36c6d8e`
- 공개 update.json 및 SHA256SUMS.txt와 파일 일치. 앱의 업데이트 검증 함수에서 1.3.0/code 4에는 업데이트를 제안하고 1.3.1/code 5에는 최신 버전으로 판정한다. 실제 폰의 설치·데이터 유지 테스트를 대신하지 않는다.
