# 위드부스

행사 현장 판매를 위한 React 웹 POS. 상품·세트 재고, 현금/계좌이체 판매 기록, 제작자별 집계, CSV 내보내기와 로컬 주문 백업을 제공한다. Vercel 서버 함수와 Postgres를 사용하며 판매·취소 주문을 IndexedDB에 먼저 보관한다.

## 하네스 안내

여기서 하네스는 다음 개발자가 같은 맥락으로 작업하고 검증할 수 있도록 만든 작업 지침·시스템 계약·운영 절차·검증 시나리오 묶음이다. 자동 테스트 프레임워크가 구축된 상태를 의미하지 않는다.

- [하네스 전용 디렉터리·읽는 순서](docs/harness/README.md)
- [에이전트 작업 지침](AGENTS.md)
- [구조·데이터·API 계약](docs/harness/architecture.md)
- [위험 분석과 개선 순서](docs/harness/risks.md)
- [실행·배포·검증 절차](docs/harness/validation.md)

작업은 로컬에서 진행하며 별도 요청 없이 커밋·푸시·PR을 생성하지 않는다. 상세 지침은 [작업 지침](AGENTS.md)에 있다.

## 실행

```powershell
npm ci
# 별도 개발 DB의 POSTGRES_URL과 충분히 긴 AUTH_SECRET을 프로세스 환경변수에 설정
npm run dev
npm run build
npm run preview
```

개발 서버는 http://127.0.0.1:4173 에서 실행하며 `.env.local`의 서버 환경변수를 로컬 API에 연결한다. 외부 DB와 분리된 로컬 PGlite DB는 `npm run dev:local`로 실행한다. 기존 `.local-data/postgres` 자료를 보존한다. 자세한 설정은 [로컬 개발](docs/local-development.md)을 참고한다. `preview`는 정적 빌드 확인용이며 API를 실행하지 않는다.

Vercel 배포는 코드상 `npm run build`/`dist`와 루트 `api/` 구조를 사용한다. 실제 Vercel 프로젝트 설정·DB 연결·운영 상태는 별도로 확인해야 한다.
