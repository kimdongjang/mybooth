# 로컬 실행

```powershell
npm run dev
```

접속 주소는 http://127.0.0.1:4173 이다. 이 포트를 사용하는 이 저장소의 이전 서버가 있다면 해당 터미널에서 Ctrl+C로 종료한 뒤 실행한다.

로컬 Vite가 api/의 서버 코드를 실행하고, .env.local의 서버 전용 환경변수 허용 목록을 Node에 주입한다. 이미 설정된 프로세스 환경변수가 우선한다. Postgres·Blob은 사용자가 설정한 Vercel 자원을 사용한다. DB/Blob 비밀값에 VITE_ 접두사를 붙이지 않는다. .env.local은 Git에서 제외하며 값은 로그에 출력하지 않는다.

기존 .env.remote.local이 남아 있어도 npm run dev는 원격 API 프록시를 사용하지 않는다. 연결된 DB의 실제 데이터에 변경이 저장되므로 화면 확인을 위해 임의의 판매·수정·삭제를 실행하지 않는다. 로컬 API는 초기화 SQL을 실행할 수 있다.

## 로컬 전용 DB로 실행

```powershell
npm run dev:local
```

Node.js 22.15 이상(또는 24 이상)이 필요하다. 접속 주소는 http://127.0.0.1:4173 이며 일반 개발 서버와 동시에 실행하지 않는다.

PGlite를 `.local-data/postgres`에 영구 저장한다. 기존 DB가 있으면 그대로 사용하며 초기화하거나 운영 자료를 가져오지 않는다. 처음 실행할 때는 회원가입으로 로컬 계정을 만든다. 기존 로컬 계정이 있다면 기존 계정으로 로그인한다.

이 명령은 DB/Blob/관리자/인증 관련 프로세스 환경변수를 제거하고 `.env*` 파일을 로드하지 않는다. 인증 키는 `.local-data/auth-secret`, 이미지는 `.local-data/images`에 보존한다. 로컬 로그인 세션과 IndexedDB 주문 큐는 일반 개발 모드와 분리한다. 운영 DB 연결로 자동 대체하지 않는다. `.local-data`는 Git에서 제외한다.

일반 `npm run dev`는 앞 절의 환경변수 기반 외부 DB 연결을 유지한다. `npm run preview`는 API를 실행하지 않는다.
