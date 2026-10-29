# 1.3.29 기기용 음성 검증

## 범위와 남은 요구

인터넷용 음성을 앱의 목록·재생 대상에서 제외한다. 같은 엔진의 동일 음성 코드에서 `-network` → `-local` 대응 항목이 실제 설치돼 있으면 연결하고, 그 외 인터넷용 선택은 기기용 기본값으로 전환한다. 서로 다른 엔진·언어의 음성을 임의로 같은 화자로 취급하지 않는다. 속도·음높이·한영 모드와 사용자 음색 메모를 보존한다. 폰 전체 TTS 음성이나 다른 앱의 설정은 삭제하지 않는다.

‘한 문장에서 동일 화자를 유지하면서 영어만 자연스러운 영어 발음’은 미해결이다. [Android setLanguage](https://developer.android.com/reference/android/speech/tts/TextToSpeech#setLanguage(java.util.Locale))는 해당 언어의 기본 목소리로 전환할 수 있으며 [Voice](https://developer.android.com/reference/android/speech/tts/Voice)는 언어·네트워크 필요 여부 등을 제공하나 언어 사이의 동일 화자 관계를 보장하지 않는다. 음성별 실제 발음은 실기기 청취가 필요하다. 이번 릴리스는 이 제한을 해결했다고 주장하거나 기존 한영 모드를 강제로 바꾸지 않는다.

## 구현

- Android의 `SpeechPreferences`에서 엔진/언어를 보존하는 저장 선택 이전과 기기용 기본값을 결정한다. 초기 목록 조회뿐 아니라 백그라운드 음성 재생 시에도 이전한다.
- `NavigationSpeech`는 인터넷 필요 음성을 목록에서 제외하고, 문장의 모든 부분에 사용할 설치 음성을 먼저 확인한 후 큐에 넣는다. 시스템 기본이 인터넷용이어도 기기용 음성으로 선택한다. 기기용 음성이 없으면 인터넷 음성을 사용하지 않는다.
- Web Speech와 이전 Capacitor 대체 경로도 네트워크 음성을 제외한다. Web Speech는 문장 일부만 큐에 넣기 전에 필요한 언어 음성이 있는지 확인한다.
- 기본 안내의 재생 주기·GPS 주기·지도 데이터·모델 다운로드를 추가/변경하지 않는다. 실제 배터리 소모는 측정하지 않았다.

## 실제 폰에서 확인

1. 기존 정식 앱에서 업데이트 후 데이터 유지, 목록에서 인터넷용 항목이 사라지는지.
2. 이전에 인터넷용을 골랐던 경우 대응 기기용 또는 기기용 기본값으로 바뀌고 속도·음높이가 유지되는지.
3. 시스템 기본이 인터넷용인 경우에도 앱이 기기용 음성을 사용하는지; 기기용 한국어/영어 음성 설치 후 비행기 모드에서 미리듣기.
4. 미리듣기, 실제 회전 안내, PiP, 화면 꺼짐/복귀에서 같은 선택이 유지되는지.
5. 한국어 선택 음성으로 ‘잠시 후 Lee Street… Harvard Avenue…’를 청취해 영어 발음 품질을 별도 평가한다. 동일 화자·자연스러운 영어 발음을 확인하기 전에는 완료로 판단하지 않는다.
6. 필요한 기기용 음성이 없는 경우 설치 안내와 지도상의 회전 안내가 유지되는지. 실제 폰의 음성 엔진별 동작을 확인해야 한다.

## 자동 검사 및 공개 APK

- Node 단위 테스트 382개, Android JVM 38개(실패/오류 0), 합성 주행 회귀 게이트 2개 통과.
- 변경 음성 화면 브라우저 검사 12개 통과. 320px·가로 화면 확인 포함. root/www 웹 자산 85개가 SHA-256 일치한다.
- Android `testDebugUnitTest`, `assembleDebug`, `lintDebug` 성공. lint 오류 0·기존 경고 19개. 의존성 감사 취약점 0.
- [main 전체 검사](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40952156255) 성공: Node/Android와 root/www 각 110개, 총 220개 브라우저 검사 통과.
- [APK 배포 검사](https://github.com/HyeokjaeKwon26/Solarless-Navi/actions/runs/40952162051)의 Node/Android 및 root/www 브라우저 전체 검사 통과. 공개 파일 검증은 아래에 기록한다.
- 배포 소스 커밋: `7911e06ef085bfd96aa77dd200cce69531032049`. 실제 폰 연결이 없어 스피커 발음·화자 동일성·Android 설치/데이터 유지·실제 배터리 소모는 검증하지 못했다.


## 공개 파일 확인 완료

- [1.3.29 릴리스](https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/tag/app-v1.3.29)의 서명/공개 작업까지 성공. versionCode 33, 패키지 `com.solaris.nav`, minSDK 22.
- 공개 APK 직접 다운로드 크기 **4,520,702 bytes (약 4.52 MB)**. 1.3.28 대비 **1,077 bytes** 증가. 추가 음성 모델·지도 DB 없음.
- SHA-256 `0b7f88cfd5f8c3df9bc4d21ce69db4a902d6194a686576c1f8303634d25feee4`. manifest 크기/체크섬과 일치. 기존 인증서 `59ea18b8ee971936d9e9780a57c4d4594b0c3b9ddbbc6318d1ba6559111f6977` 일치 및 APK 서명/비디버그 속성 검증 완료.
- APK 웹 자산 85개가 배포 소스 www와 바이트 단위 일치. 새 기기용 기본 선택 정책과 기존 네이티브 주행·음성 코드 포함 확인.
- 실제 공개 GitHub 응답과 배포 updater로 code 9, 17~29, 32에 업데이트 표시 및 code 33에 최신 버전 표시 확인. 설치 버전 식별 정보는 Chromium 모의값이며 같은 공개 응답을 재사용했다. 실제 Android 설치/기존 데이터 유지 검증은 아니다.
- [검증 영수증](data/app-release-1.3.29-verification.json)에 전체 검사 결과와 미확인 범위를 기록했다.
