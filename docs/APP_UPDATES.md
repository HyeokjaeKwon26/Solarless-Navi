# Android 앱 업데이트와 APK 배포

## 새 서명키로 전환 (2026-10-23)

사용자가 기존 앱 삭제와 새 서명키로의 재설치를 승인했다. 첫 새 키 배포는 `app-release.json`의 **1.1.0 / versionCode 2**이며 패키지는 `com.solaris.nav`로 유지한다. 새 정식 인증서 SHA-256:

```text
59ea18b8ee971936d9e9780a57c4d4594b0c3b9ddbbc6318d1ba6559111f6977
```

이 키는 RSA 3072비트, 유효기간 10,000일로 생성했다. 앞으로 모든 APK는 이 키로 서명한다. 배포 검증은 실제 APK의 인증서가 위 지문과 일치하는지 확인하고, 후속 앱 태그에서도 패키지·인증서 변경을 거절한다.

보관된 구버전 `SolarLessNavi_v1.0.apk`의 인증서는 `8ec1a26e9c1eefeac384660973a0a9a99341071f1233ab196d315b3ce40a0a0d`이며 개인키를 찾지 못했다. 이 PC의 디버그 인증서도 새 정식 키와 다르다. **이번 한 번은 기존 앱을 삭제하고 새 정식 APK를 설치한다. 삭제 시 설정·즐겨찾기 등 앱 데이터가 사라질 수 있으므로 필요한 내용은 먼저 별도로 기록한다.** 서명 계보 회전이나 기존 데이터 자동 이관을 구현한 것은 아니다. [Android 서명 문서](https://developer.android.com/studio/publish/app-signing)를 따른다.

### 키 보관과 백업

- 로컬 키: `%LOCALAPPDATA%\SolarLessNavi\signing\release-20261023\solarless-release.keystore`
- 비밀번호: 같은 폴더의 `release-credential.xml`에 Windows DPAPI로 암호화해 보관한다. 이 Windows 사용자와 컴퓨터에서 복호화한다. 폴더 접근은 현재 사용자와 SYSTEM으로 제한했다.
- GitHub: 저장소 Actions Secrets 4개에 등록했다. 공개 소스·릴리스에는 키와 비밀번호를 포함하지 않는다. GitHub Secrets는 값을 다시 내려받는 백업 수단이 아니다.
- 로컬 폴더만 다른 PC로 복사하면 DPAPI 비밀번호를 복호화하지 못할 수 있다. 이 PC를 초기화하기 전에 아래 명령으로 **외장 드라이브 등 저장소 밖에 별도 비밀번호를 가진 휴대 가능한 백업**을 만든다. 백업 비밀번호는 별도 비밀번호 관리자에 저장한다.

```powershell
# 실제 존재하는 외장 드라이브 경로로 바꿔 실행한다. 비밀번호는 화면에 표시하지 않고 입력받는다.
./tools/export-signing-backup.ps1 -Destination 'E:\PrivateBackup\SolarLessNavi-release.p12'
```

백업 파일을 GitHub나 공개 폴더에 올리지 않는다. 새 키와 백업을 모두 잃으면 같은 앱의 후속 업데이트를 계속할 수 없다.

## 앱에서의 동작

1. 앱 시작 후 업데이트를 확인한다. 성공한 자동 확인은 6시간 동안 다시 요청하지 않는다. 설정의 **업데이트 확인**은 즉시 다시 확인한다.
2. GitHub Releases의 안정 버전 `app-vX.Y.Z`와 `update.json`을 사용한다. scene 데이터 릴리스, 초안, 사전 배포는 제외한다. 최대 5페이지·500개 릴리스를 확인하므로 운영 시 오래된 앱 릴리스가 이 범위 밖으로 밀리지 않도록 유지한다.
3. 설치된 앱의 실제 versionCode·패키지·인증서·Android 버전과 비교한다. 더 새 버전이며 서명이 일치할 때만 다운로드를 제공한다. 브라우저에서는 APK 설치를 제공하지 않는다.
4. 사용자가 다운로드를 누르면 앱 전용 캐시에 저장한다. 진행률과 취소를 제공하고 HTTPS 대상·용량(최대 100 MiB)·SHA-256·실제 APK 패키지·서명·버전을 검증한다. 설치 직전에도 다시 검증한다.
5. 설치 버튼을 누르면 Android의 설치 허용 설정 또는 설치 확인 화면을 연다. 설치 허용 후에는 사용자가 설치 버튼을 다시 눌러야 한다. 시스템 설치 확인이 필요하며, 무인 설치나 설치 완료를 추정하는 처리는 없다.

주행 안내가 켜져 있거나 앱이 이동 속도를 감지하면 알림을 보류하고 설치 조작을 막는다. 주행 종료 후 화면이 보일 때 다시 안내한다. GPS 속도 감지는 안전을 보장하지 않으므로 업데이트는 정차 후 수행한다. 네트워크 단절·취소·검증 실패는 기존 앱을 변경하지 않는다. 다운로드 재개는 지원하지 않으며 다시 처음부터 받는다. 프로세스가 종료되거나 캐시 파일이 사라지면 다시 확인·다운로드한다.

첫 `1.1.0` APK는 GitHub Releases에서 수동으로 받아 기존 앱을 삭제한 뒤 설치한다. 이후 릴리스부터 새 앱 내부의 설치 흐름을 이용할 수 있다.

## GitHub 배포 설정

저장소 **Settings → Secrets and variables → Actions**에 아래 Secrets를 새 정식 키로 등록했다. 비밀번호와 키 파일을 채팅, 소스, 로그 또는 공개 릴리스에 넣지 않는다.

| Secret | 내용 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 새 정식 키 파일의 Base64 전체 내용 |
| `ANDROID_STORE_PASSWORD` | 키 저장소 비밀번호 |
| `ANDROID_KEY_ALIAS` | 새 정식 키 alias |
| `ANDROID_KEY_PASSWORD` | 해당 키의 비밀번호 |

워크플로는 키를 임시 디렉터리에 복원하고 종료 시 제거한다. 서명 APK에 `apksigner` 검증을 실행하며, 인증서가 위 지문과 다르면 게시 전에 실패한다. 디버그 키를 Secrets에 넣어 우회하지 않는다. 저장소 설정과 워크플로 변경 권한은 배포 권한에 해당한다.

### 새 버전 게시

1. `app-release.json`의 versionName과 versionCode를 모두 높이고 `docs/RELEASE_NOTES.md`를 갱신한다. packageName과 certificateSha256은 유지한다. minSdk 변경 시 Android 설정도 일치시킨다.
2. 소스를 main에 커밋·푸시하고 CI 성공을 확인한다.
3. GitHub Actions의 **APK release**를 main에서 실행한다. `publish=false`는 테스트만 실행한다. `publish=true`로 실행하면 현재 설정의 앱 릴리스를 만든다. 또는 같은 커밋에 `app-v1.1.0` 형식의 태그를 푸시하면 게시 작업이 실행된다.
4. 검증 통과 후 `SolarLessNavi-X.Y.Z.apk`, `update.json`, `SHA256SUMS.txt`가 공개 릴리스에 게시된다. 이미 존재하는 릴리스는 덮어쓰지 않는다. 같은 버전 태그가 다른 커밋을 가리켜도 실패한다.

일반 main CI와 배포 검증은 Node·브라우저 회귀 테스트, root/www 일치 검사, Android 단위 테스트와 debug 빌드를 실행한다. 게시 작업은 추가로 고정된 정식 키 서명, APK 실제 메타데이터 및 버전 증가를 검증한다. 서명키가 없으면 게시 작업이 실패하고 APK를 공개하지 않는다.

로컬 서명 빌드는 저장소 밖의 `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`를 사용한다. Node 24, JDK 17, Android SDK build-tools 34.0.0이 필요하다. `build_apk.bat`는 검증된 새 파일을 `dist-release/`로 내보내며 기존 `SolarLessNavi_v1.0.apk`를 덮어쓰지 않는다.

## 검증 범위와 남은 실기기 확인

로컬 검증에서 Node 196개, Chromium 28개(root/www 각각 14개), Android 업데이트 정책 6개와 기존 예제 1개가 통과했다. APK 빌드와 Android Lint도 통과했으며 Lint는 오류 0개·기존 리소스/설정 관련 경고 17개를 보고했다. `npm audit` 취약점은 0개다. 실제 디버그 APK를 배포 도구에 입력하면 서명 불일치로 거절하며 배포 파일을 생성하지 않는 것을 확인했다. 서명 설정 없는 release 빌드도 실패하도록 검증했다.

자동 검증은 버전·서명 정책, 배포 메타데이터 생성, 브라우저의 다운로드/취소/오류/권한 재시도/주행 보류를 다룬다. 브라우저 테스트의 Android 플러그인과 네트워크는 모의 응답이다. Android 단위 테스트와 컴파일 성공만으로 실제 다운로드·기기별 설치 화면·데이터 유지를 확인한 것은 아니다. Lint 중 발견한 기존 위치 권한·방송 수신·PiP의 API 호환성 문제도 수정했다.

폰 연결 후, 정차 상태에서 다음을 수행한다.

- 설치 APK를 ADB로 추출해 서명을 비교하고 현재 versionCode를 기록한다.
- 이번 최초 전환은 기존 앱 삭제 후 새 APK를 설치한다. 이후 같은 새 키의 후속 버전 업데이트에서 설정·즐겨찾기 유지 여부를 확인한다.
- 설치 허용 거부/허용 후 복귀, 시스템 설치 취소, 실제 업데이트 완료 후 재실행을 확인한다.
- Wi-Fi/모바일 데이터 전환, 다운로드 중 화면 꺼짐·프로세스 종료·저장 공간 부족, 다시 다운로드를 확인한다.
- 주행 안내 중 알림이 숨겨지는지와 종료 후 복귀를 확인한다. 실제 주행 판단 품질은 별도 [주행 검증 목록](DRIVING_VALIDATION.md)을 따른다.

이번 서명키 전환은 재설치이며 구버전 데이터 유지 업데이트가 아니다. 실제 폰의 설치와 후속 버전 데이터 유지 검증은 아직 미실시다.
