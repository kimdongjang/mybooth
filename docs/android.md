# 안드로이드 앱

기존 React 화면, Dexie/IndexedDB 주문·행사 캐시, API/동기화 로직을 Capacitor 8 앱에서 공유한다. SQLite나 별도 서버 DB는 추가하지 않는다. 앱 ID는 `com.mybooth.pos`, 초기 네이티브 버전은 `1.0`이다. Play 최초 등록 전에 ID 소유권과 최종 이름을 확인한다.

## 로컬 실행과 빌드

Node 22 이상(검증 Node 24), JDK 21, Android Studio 및 Android SDK 36이 필요하다.

```sh
npm ci
npm run android:sync
npm run android:open
```

`.env.android`의 공개 API origin은 `https://withbooth.vercel.app`이다. 테스트 서버로 바꾸려면 `.env.android.local`을 사용한다. DB 비밀번호·AUTH_SECRET을 VITE 변수에 넣지 않는다. 웹 빌드는 `npm run build` 그대로다. Android Studio에서 기기를 선택해 실행하거나 `android/gradlew assembleDebug`로 테스트 APK를 만든다. GitHub Actions의 Android debug build도 APK 아티팩트를 생성한다. 디버그 APK는 Play 출시용이 아니다. 앱 표시 이름은 WithBooth이며 런처 아이콘·스플래시는 파란색 배경의 흰 Wb 심볼이다. 앱 ID com.mybooth.pos는 기존 설치/데이터 호환성을 위해 보존한다. Play 출시는 별도 업로드 키로 서명한 AAB, 개발자 계정·스토어 정보·심사가 필요하다. 키는 커밋하지 않는다.

## 웹 배포로 앱 화면 업데이트

원격 `server.url`은 쓰지 않는다. 기본 웹 파일을 앱에 포함하고, `@capgo/capacitor-updater`를 클라우드 자동 업데이트 없이 자체 호스팅 모드로 사용한다. 별도 Capgo 계정은 필요하지 않다.

Vercel의 Build Command를 **`npm run build:release`**로 설정하면 동일 배포의 웹 화면과 앱용 ZIP/manifest를 함께 생성한다. 코드만 추가해도 기존 Vercel 설정이 자동으로 바뀌지는 않는다. 이 명령은 API 요청이나 DB 작업을 실행하지 않는다. 일반 `npm run build`에는 앱 업데이트 파일이 포함되지 않는다.

수동 준비도 가능하다.

```sh
npm run android:bundle -- 2026.10.20-1 https://withbooth.vercel.app
```

`mobile-release/mobile-updates/`의 ZIP을 서버 `/mobile-updates/`에 먼저 올리고 `latest.json`을 마지막에 공개한다. 버전은 매번 고유해야 하며 ZIP 내용을 같은 버전으로 덮어쓰지 않는다. SHA-256 checksum과 같은 HTTPS origin을 검증하고, `nativeContract`와 Android `versionName`이 일치하는 앱에만 전달한다. 네이티브 플러그인·권한·호스트·계약이 바뀌면 스토어 업데이트가 필요하다. 배포자 계정과 HTTPS 서버가 신뢰 경계이며 별도 서명키 기반 OTA 서명은 아직 구성하지 않았다.

앱은 실행·연결 복구·포그라운드 복귀 때 manifest를 확인한다. 다운로드 후 `kill` 지연 조건으로 다음 프로세스 재실행에 적용하며 판매 중 새로고침하지 않는다. 다운로드 실패는 현재 번들을 유지한다. 새 번들은 DB 열기와 Web Locks 확인 및 React 마운트 후 준비 완료를 알리고, 준비 실패 시 플러그인의 이전 번들 복구를 사용한다. 이 건강 검사는 모든 판매 기능의 정상 동작을 보증하지 않는다. 실패 버전은 보존해 반복 다운로드하지 않으며 수정본은 새 버전으로 배포한다. 이전·실패 번들을 자동 삭제하지 않으므로 장기 사용 시 저장 공간 정리 정책이 필요하다.

## 저장·오프라인 계약

- 앱 origin은 **`https://localhost`**로 고정한다. 배포 도메인이나 번들 경로가 바뀌어도 IndexedDB 주소는 바꾸지 않는다. 앱 ID·origin을 바꾸면 기존 앱 데이터에 접근하지 못할 수 있다.
- 웹의 Service Worker는 앱에서 등록하지 않는다. 앱 번들은 네이티브 업데이트 플러그인이 관리하고, 일반 브라우저는 기존 SW를 유지한다.
- 앱 내부 `/api/` 요청만 설정한 서버로 보내며 CapacitorHttp의 네이티브 fetch 전송으로 기존 Bearer 인증을 사용한다. 외부 Blob 업로드 URL은 변경하지 않는다. 서버 API·CORS·Postgres 계약은 변경하지 않는다.
- 앱에서는 기존 세션의 세 키와 계정별 행사 목록을 앱 WebView localStorage에 보존해 프로세스 종료 후 복원한다. 로그인 토큰은 암호화 저장이 아니며 Android 앱 백업은 끈다. 공용 기기는 사용 종료 시 로그아웃한다. 웹의 sessionStorage 정책은 유지한다.
- **첫 로그인과 사용할 행사 선택·다운로드는 온라인에서 완료해야 한다.** API 인증 거절 시 캐시로 우회하지 않는다. 연결 오류 시 저장된 행사 목록·상태로 복귀한다. 토큰 만료 후에는 온라인 재로그인이 필요하다.
- 주문 추가·재고/판매 갱신은 기존 IndexedDB 원자 트랜잭션을 사용한다. `localOrderId`, 행사 범위, SYNCING 회수·순서 전송·재시도 계약을 유지한다. 앱 복귀 때 기존 동기화를 깨운다. 앱 종료 중 백그라운드 전송은 제공하지 않는다.
- Chrome과 앱의 저장소는 별개다. 브라우저 미전송 주문은 브라우저에서 먼저 동기화한다. 앱 삭제·데이터 삭제·저장소 손상은 서버 미전송 주문을 잃게 할 수 있다. 앱 업데이트는 데이터 백업이 아니다.
- IndexedDB 마이그레이션은 웹 코드로 전달할 수 있지만 이전 번들로의 복구와도 호환되어야 한다. 파괴적인 스키마 변경은 이 업데이트 경로에서 금지하고 별도 데이터 이전 계획을 세운다.
- 외부 상품 이미지는 오프라인 캐시 보장이 없다. Android WebView에서 이미지 업로드·주문 백업 다운로드·파일 선택은 실기기 검증이 필요하다.

## 출시 전 실기기 검증

별도 테스트 계정/DB로 온라인 준비 → 비행기 모드 판매·취소 → 앱 강제 종료 → 오프라인 재실행에서 행사/주문/재고 보존 → 연결 복구 및 중복 없는 전송을 확인한다. 다운로드 중 단절·손상된 ZIP·호환되지 않는 manifest·실패 번들 복구·미전송 주문을 가진 상태의 번들 교체도 확인한다. 앱 전환만으로 업데이트가 적용되어 장바구니가 사라지지 않는지 확인한다. 인증 만료, 계정 전환, 무료 상품, 파일 업로드/백업, Android 뒤로가기·안전 영역을 포함한다. 웹 빌드/Node 테스트는 이 검증을 대신하지 않는다.

참고: [Capacitor](https://capacitorjs.com/docs), [자체 호스팅 업데이트](https://capgo.app/docs/plugins/updater/self-hosted/manual-update/), [업데이트 API와 지연 조건](https://capgo.app/docs/plugins/updater/api/).
