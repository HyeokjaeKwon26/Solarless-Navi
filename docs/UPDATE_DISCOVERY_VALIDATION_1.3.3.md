# 1.3.3 업데이트 조회 오류 수정

## 원인과 재현

1.3.2의 `/releases?per_page=100&page=1` 요청에는 지도 scene 릴리스의 수천 개 파일 정보도 포함됐다. 실제 공개 응답은 5,948,473 bytes였으며 앱의 JSON 응답 제한 2MiB를 초과했다. 공개 응답을 기존 updater에 전달했을 때 사용자와 동일한 `Invalid update information.` 상태를 재현했다. APK 서명 오류가 아니다.

이전 검증은 개별 APK/manifest를 확인했고 브라우저의 배포 목록 fixture는 작았다. 실제 전체 목록을 통한 조회까지 검증하지 않아 오류를 놓쳤다.

## 변경

- `/git/matching-refs/tags/app-v`에서 앱 태그만 조회한 후 의미적 버전 내림차순으로 `/releases/tags/{tag}`를 확인한다.
- 아직 공개 릴리스가 없는 태그(404), prerelease/draft, update.json이 없는 릴리스는 건너뛴다. 최대 최근 20개 앱 태그를 확인한다.
- 전체 지도 배포 목록은 요청하지 않는다. JSON 크기 제한, manifest URL/버전/해시/서명 검증은 유지한다.
- 최초 공개 응답 검증에서 태그 2,168 bytes, 앱 릴리스 10,311 bytes, manifest 2,585 bytes로 최신/새 버전 판정이 모두 성공했다.

## 검증 방법

- 브라우저 fixture의 전체 목록은 6MiB로 구성해 기존 조회 방식으로 돌아가면 실패하도록 했다.
- 앱 태그의 정렬, 게시 준비 중 404, prerelease, scene 태그 제외, 빈 목록 및 octet-stream manifest를 검증한다.
- `node tools/check-live-update.cjs`는 실제 공개 GitHub 응답을 Chromium에서 실행하는 배포 코드에 전달한다. 현재 코드와 이전 설치 코드의 판정을 모두 확인한다.
- 이 smoke 검증의 설치 정보는 모의 값이며 HTTP 전달은 Node가 중계한다. Android HTTP 프록시와 실제 설치기/데이터 유지 검증을 대신하지 않는다.

## 실제 폰 확인

로컬 자동 검증 결과: Node 231개, 브라우저 root/www 62개, Android JVM 11개 통과. Android debug 빌드와 lint 성공(0 errors, 기존 19 warnings). root/www 50개 파일 SHA-256 일치, npm audit 취약점 0개. 공개 서버 smoke 검증에서 최신/새 버전 판정 모두 통과했다.

1. 1.3.2는 조회 코드 자체에 오류가 있으므로 1.3.3 APK를 직접 받아 기존 앱 위에 설치한다. 기존 앱을 삭제하지 않는다.
2. 설정의 업데이트 확인에서 `최신 버전입니다 (1.3.3)`가 표시되는지 확인한다.
3. 다음 정식 배포 후 새 실행에서 업데이트/계속 사용 안내와 수동 확인을 확인한다.
4. 다운로드, 설치 권한 승인/취소, Android 설치 완료 및 설정·즐겨찾기·기록 유지 여부를 확인한다.

이 변경의 확인에는 실제 주행이 필요하지 않다. 연결된 실기기가 없어 폰에서의 확인은 아직 하지 않았다.
