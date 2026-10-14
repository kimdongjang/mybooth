# 구조와 계약

분석 기준: 2026-10-14 로컬 작업 트리. `api/pos.js`, `src/App.jsx`, `vite.config.js`에 기존 변경이 있는 상태를 분석했다. 운영 Vercel 계정/DB를 조회하지 않았다.

## 제품 범위

관리자가 가입/로그인하고 자신의 행사 프로젝트를 생성한다. 프로젝트별 상품·세트·판매 내역을 관리한다. 장바구니에서 현금 또는 계좌이체를 선택하면 로컬 판매를 기록한다. 실제 카드 승인, 계좌 입금 조회, 영수증 발급, 세무 처리는 구현되어 있지 않다.

현장 오프라인 판매와 인터넷 오프라인 기능을 구분해야 한다. 로그인·가입·프로젝트 목록·상품/세트 설정은 서버 통신이 필요하다. 이미 로그인하여 프로젝트를 연 탭에서는 캐시 데이터로 판매·취소를 계속할 수 있지만, 인터넷 없이 새로 앱을 시작하는 흐름은 완전하지 않다.

## 구성

```mermaid
flowchart LR
  UI[React App] --> Session[sessionStorage 인증/선택 프로젝트]
  UI --> State[IndexedDB posState]
  UI --> Queue[IndexedDB orders]
  Queue --> Sync[SyncService]
  Sync --> API[Vercel /api/pos]
  UI --> Auth[Vercel /api/auth]
  UI --> API
  Auth --> DB[(Postgres)]
  API --> DB
  SW[Service Worker] --> Shell[HTML/JS/CSS 캐시]
```

| 경로 | 역할 |
| --- | --- |
| `src/App.jsx` | 인증, 프로젝트, POS, 재고·세트 설정, 집계, 백업, 로컬 판매/취소 |
| `src/database/dexie.ts` | IndexedDB 버전 1~3 및 테이블 정의 |
| `src/database/orderRepository.ts` | 프로젝트별 주문 추가/조회/상태 변경/미전송 주문 제거 |
| `src/database/stateRepository.ts` | 프로젝트별 마지막 UI 상태 저장 |
| `src/sync/syncService.ts` | 주문 순차 전송, 실패 재시도, 대기 수 집계 |
| `src/hooks/useSync.ts` | 시작 시/10초 주기/online 이벤트 동기화 |
| `src/components/SyncStatus.tsx` | 네트워크·대기 상태와 수동 동기화 버튼 |
| `src/utils/orderId.ts` | 로컬 시간 + 랜덤 6자리 hex 주문 ID |
| `api/auth.js`, `api/lib/auth.js` | 가입/로그인, scrypt 비밀번호, HMAC 토큰 |
| `api/pos.js` | 소유권 검사, 테이블 생성, 상품·세트·판매 처리 |
| `api/lib/defaultData.js` | seed version 3, 기본 상품 44개/세트 7개 |
| `public/sw.js` | 앱 셸과 정적 리소스 캐시, `/api/` 제외 |
| `vite.config.js` | React/Tailwind 빌드와 로컬 API 어댑터 |
| `pos.html` | 독립 localStorage 구현; 기본 빌드 엔트리에서 참조하지 않음 |

의존성은 React, Vite, Tailwind, Dexie, `@vercel/postgres`다. 일부 버전은 package.json에 `latest`로 선언되어 실제 재현에는 package-lock.json이 필요하다. JSX와 TS/TSX가 혼재하며 tsconfig, lint 스크립트는 없다. `npm test`는 Node 테스트 러너로 기본값 API 회귀 테스트를 실행한다.

## 저장 모델

| 저장소 | 데이터/키 | 특성 |
| --- | --- | --- |
| sessionStorage | `pos_admin_token`, `pos_admin_id`, `pos_selected_project_id` | 탭 세션 인증/선택; 새 세션 오프라인 인증 보장 없음 |
| IndexedDB `booth-pos-offline-db.orders` | 자동증가 id, projectId, localOrderId, createdAt, payload, syncStatus, retryCount, lastSyncAt | 상태: PENDING/SYNCING/SYNCED/FAILED/ARCHIVED; 주문과 취소 명령 저장 |
| IndexedDB `posState` | `project:{projectId}:latest`, state, updatedAt | products/bundles/sales 스냅샷; 주문 큐와 별도 저장 |
| Postgres `pos_admins` | id PK, password_hash, created_at | 가입 또는 환경변수 기반 초기 관리자 생성 |
| `pos_projects` | id PK, admin_id FK, name, seed_version, timestamps | 관리자 소유 프로젝트; FK cascade |
| `pos_products` | (project_id,id) PK, 가격/재고/제작자/굿즈/세트 메타데이터 | stock/stock_qty 병행; 가격·재고 INTEGER |
| `pos_bundles` | (project_id,id) PK, name, price, items JSONB | items = productId/qty 목록 |
| `pos_sales` | (project_id,id) PK, time, method, total, lines JSONB | localOrderId를 서버 판매 ID로 사용 |

상품은 id/productCode, goodsType, vtuberName, creatorName, stockQty, initialStockQty, size, price, setCreatorName/setGroupName/setPrice/setDescription, isActive, timestamps를 사용한다. 표시 호환용 name/stock도 존재한다. 상품의 세트 메타데이터와 실제 판매용 bundles는 별개이며 자동 연결 로직은 없다.

상품의 선택적 `imageUrl`은 Postgres `image_url` 및 IndexedDB 상품 스냅샷에 보존한다. `/api/product-images`는 인증·프로젝트 소유권·상품 존재·경로를 확인한 후 JPG/PNG/WebP, 최대 5MiB의 Blob 직접 업로드 토큰을 발급한다. 파일은 Public Vercel Blob에 저장되고 판매 카드와 상품 관리에서 URL로 표시한다. `updateProductImage`는 해당 프로젝트/상품 이미지 URL만 변경하며 null로 제거한다. 기존 DB의 image_url은 ADD COLUMN IF NOT EXISTS로 추가한다. 이미지 교체/제거 시 이전 Blob은 삭제하지 않으므로 별도 정리 정책이 필요하다. 이미지 URL은 공개이며 민감한 이미지를 저장하지 않는다. 오프라인에서 외부 이미지 표시를 보장하지 않고 로드 실패 시 대체 문구를 표시한다.

테이블은 요청 중 `CREATE TABLE IF NOT EXISTS`로 생성한다. 이전 단일 행사 DB에는 project_id와 상품 메타데이터, 프로젝트 seed_version을 보완한다. 단일 id 기본키는 제거하고 (project_id,id) 고유 인덱스를 추가하며, 이 키 전환은 DO 블록의 한 트랜잭션에서 수행한다. 사용자가 지정한 과거 project_id=NULL 행은 admin의 7월 서코행사에 원자적으로 연결한다. admin이 없으면 NULL로 보존한다. 신규 DB는 기존처럼 복합 기본키를 사용한다. 신규 DB에서는 auth 초기화로 pos_admins가 먼저 생성되는 흐름을 전제한다.

## API

`/api/auth` 외 POS 요청은 `Authorization: Bearer <token>`을 사용한다. 토큰은 JSON payload와 HMAC-SHA256 서명으로 구성된다. iat는 있지만 만료 검사가 없다. POS는 프로젝트 관리자 소유권을 확인한다.

| 요청 | 입력 | 반환/효과 |
| --- | --- | --- |
| POST `/api/auth` | `{mode: 'signup' 또는 'login', id, password}` | token/admin; mode 생략 시 login |
| GET `/api/pos` | 없음 | 로그인 관리자 projects 목록 |
| GET `/api/pos?projectId=…` | projectId | products/bundles/sales 전체 상태 |
| POST createProject | payload.name | 201 project; 빈 상품·세트·판매로 시작 |
| POST replaceProducts | payload.products | 상품 전체 삭제 후 재삽입 |
| POST replaceBundles | payload.bundles | 세트 전체 삭제 후 재삽입 |
| POST finalizeSale | localOrderId, createdAt, method, total, cart | 재고 차감, 판매 저장; 기존 판매 ID면 중복 검사 후 반환 |
| POST voidSale | payload.id | 판매 삭제 및 재고 복구; 판매 없으면 no-op |
| POST clearSales | payload.password | 비밀번호 확인 후 판매만 삭제; 재고 복구 없음 |
| POST resetDefaults | 빈 payload | 상품·세트 삭제 후 기본값 삽입, 재고 초기화; 판매 내역 유지 |
| POST upsertDefaults | 빈 payload | (project_id,id) 충돌은 DO NOTHING; 없는 기본 상품·세트만 추가, 기존 설정/현재·초기 재고/판매 유지 |

POS POST body는 `{projectId, action, payload}`다. 서버는 query/body/payload에서도 projectId를 찾는다. createProject 외 성공 응답은 전체 상태다. 인증 실패 401, 미지원 method 405, 미지원 action/projectId 누락 400, 처리 예외는 대체로 500이다. 입력/재고 충돌을 구분한 오류 계약은 아직 없다.

기본값 작업은 미동기화(PENDING/FAILED/SYNCING) 주문이 있으면 UI에서 차단한다. 비활성 기본 상품이나 수정한 세트도 업데이트 시 덮어쓰지 않는다. resetDefaults는 사용자 상품/세트를 제거하므로 유지된 과거 판매의 제작자 집계·세트 취소 결과가 달라질 수 있음을 확인 문구에 명시한다. 서버는 다른 기기의 대기 큐를 알 수 없으며 트랜잭션/동시성 문제는 P1에 남아 있다.

```json
{
  "projectId": "example-project",
  "action": "finalizeSale",
  "payload": {
    "localOrderId": "20261014-120000-ABCDEF",
    "createdAt": "2026-10-14T03:00:00.000Z",
    "method": "cash",
    "total": 1000,
    "cart": [{"type":"product","id":"P001","name":"예시","unitPrice":1000,"qty":1}]
  }
}
```

## 판매·취소·동기화 흐름

1. UI가 단품 및 세트 구성품의 장바구니 예약 수량을 계산한다. 세트 가용 수량은 구성품별 가용 재고/필요 수량의 최솟값이다.
2. 결제 시 주문 큐에 PENDING을 먼저 저장하고 로컬 재고·판매를 갱신한다. 상태 스냅샷 저장은 await하지 않는다. 결제 완료 알림은 이 시점에 표시된다.
3. SyncService가 현재 프로젝트 PENDING/FAILED를 createdAt 순으로 전송한다. 각 주문은 SYNCING → SYNCED 또는 FAILED가 되고 실패 횟수가 증가한다.
4. 서버는 단품/현재 세트 구성으로 재고를 검사하고 차감 후 판매를 삽입한다. 이 일련의 SQL은 트랜잭션으로 묶이지 않는다.
5. 성공 응답의 서버 상태는 SyncService에서 UI/posState에 적용하지 않는다. 자동 서버 재조회도 없다.
6. 취소는 로컬 재고·판매를 먼저 바꾼다. PENDING/FAILED 판매면 큐에서 제거하고, 제거하지 못하면 별도 voidSale 주문을 추가한다. 서버 취소는 현재 세트 구성으로 복구하고 판매를 삭제한다.

서비스 워커는 navigation에 network-first, 다른 같은 출처 GET에 stale-while-revalidate를 적용한다. 설치 시 index의 `/assets/` 링크를 캐시한다. 버전은 `booth-pos-app-v16`, 설치/활성화 시 skipWaiting/clients.claim을 사용한다. 기본 상품 이미지 `/images/default-product.svg`도 앱 셸 캐시에 포함한다. 판매 카드와 상품 관리에서 이미지가 없거나 외부 이미지 로드 실패 시 No Image SVG를 표시한다. [기본 이미지 설명](default-product-image.md).

제작자별 집계는 현재 상품·세트 정보를 참조한다. 세트 매출은 현재 구성품 단가×수량 비중으로 배분한다. 과거 구성/단가 변경 시 집계가 변할 수 있다. 판매 CSV와 IndexedDB 주문 JSON/CSV 다운로드가 있지만 복원 UI는 없다.

## 화면 디자인 (2026-10-14)

웹 앱 표시 이름은 **마이 부스**다. 로그인 화면, 판매 화면 상단과 브라우저 탭 제목에 동일하게 표시한다. 독립 구현 `pos.html`은 별도 구현이므로 기존 이름을 유지한다.

Vite 화면은 흰색 카드/주문 패널과 파란색 주요 버튼, Pretendard 가변 폰트를 사용한다. 폰트와 OFL 라이선스는 public/fonts에 포함하며 서비스 워커 앱 셸 캐시에 폰트를 추가한다. 768px 미만에서는 판매·관리·내역 및 프로젝트/계정 메뉴를 햄버거 드롭다운으로 표시한다. 연결·대기 상태와 수동 동기화를 하나의 SyncStatus 버튼으로 묶어 햄버거 옆에 배치한다. 아이콘은 메뉴를 열면 X로 전환되고 드롭다운은 페이드/이동 애니메이션을 적용한다. 동작 줄이기 설정에서는 애니메이션을 끈다. 모바일은 64px 높이의 한 줄 앱바에서 브랜드를 왼쪽, 동기화 버튼과 햄버거를 최상단 오른쪽에 배치한다. 모바일 제목 20px, 상품명/주요 버튼 14px, 가격 16px, 보조 정보 12px, 주문 합계 28px로 구분하며 입력은 16px을 사용한다. 이전 18px 일괄 확대 규칙은 제거했다. 데스크톱은 브랜드/탐색/상태를 같은 앱바에 배치하고 768~1199px에서는 탐색만 두 번째 줄에 배치한다. 상품 목록은 독립 스크롤하고 주문금액·결제 패널은 하단 sticky 위치에 유지한다. 주문 상세는 펼쳐 수량/삭제를 조작하며, 데스크톱은 상단 메뉴와 우측 주문 패널을 유지한다. 판매 목록은 상단 단품 구매/세트 구매 탭으로 분리한다. 제작자 필터는 두 탭에 공통 적용하며 세트는 해당 제작자의 구성품을 포함하면 표시한다. 비선택 필터는 중립색이고 선택 필터만 강조색을 사용한다. 탭 전환은 장바구니를 유지하며 프로젝트 변경 시 탭/필터를 초기화한다. 판매 카드 이미지는 정사각형으로 카드 너비를 채우고 재고는 가격 옆에 표시한다. 이미지 원본은 object-contain으로 보존한다. 판매·재고·주문 큐 및 API 계약은 유지한다. 독립 구현 pos.html은 변경하지 않았다.

## 사용자·행사별 데이터 분리 (2026-10-14)

- 새 프로젝트는 빈 상품·세트·재고로 시작한다. 기본값 추가/초기화는 선택한 행사에서 사용자가 명시적으로 실행한다.
- 관리자 소유권 + project_id로 상품·가격·재고·세트·판매를 제한한다. IndexedDB 상태와 큐는 서버의 전역 고유 프로젝트 ID로 분리한다.
- project_id=NULL인 과거 상품·세트·판매만 admin 계정의 '7월 서코행사'에 연결한다. 기존 지정 프로젝트는 이동하지 않는다. admin 계정이 없으면 연결을 보류한다. 대상 행사에 동일 ID가 있으면 트랜잭션 전체가 실패하고 원본을 보존한다.
- 배포 후 인증된 POS 요청의 초기화에서 연결이 실행된다. 운영 적용 전에 백업 및 별도 DB 검증이 필요하다. 운영 DB는 이번 작업에서 조회/변경하지 않았다.
- 프로젝트 전환/로그아웃 후 늦은 상태 응답을 무시하고 동기화 배치는 시작 당시 토큰과 프로젝트로 고정한다. 다른 범위 주문은 전송하지 않는다.
- 검증: npm test 7개와 npm run build 통과. PGlite에서 빈 행사 생성, 다른 계정 접근/변경 제한, 과거 재고·무료 가격·세트·판매 보존 및 반복 연결 확인. 실제 브라우저 AUTH-01/SWITCH-01/OFF-01/02/CACHE-01 및 운영 마이그레이션은 미실행.

## 기존 12월 행사 정리 (2026-10-14)

- 사용자가 지정한 admin 소유 pxwiu2t(12 서코), s4fjgga(12월 행사)만 한 번 비운다. 행사 ID/이름을 유지하며 상품·가격·재고·세트·판매를 초기화하고 seed_version을 0으로 변경한다. 7월 서코행사 및 다른 행사/사용자는 유지한다.
- pos_event_archives에 프로젝트 및 상품·세트·판매 원본 JSON과 revision을 보관한 뒤 같은 SQL 트랜잭션에서 정리한다. 실패하면 보관/초기화를 함께 롤백한다. 보관 행이 재실행 방지 표식이므로 임의로 삭제하지 않는다. 복원 UI는 없으며 별도 DB에서 JSON 복원 절차를 검증해야 한다.
- 정리된 행사 GET 응답의 dataRevision을 POST/오프라인 주문에 포함한다. 이전 revision/누락 요청은 409로 거절한다. 새 앱은 서버 상태 확인 후 동기화를 시작하며 이전 미전송 주문을 ARCHIVED로 보존하고 재전송/대기 집계에서 제외한다. 주문 JSON/CSV 백업에는 포함한다. 대상 행사에서 revision 없는 옛 오프라인 캐시는 사용하지 않는다.
- 배포 후 인증된 POS 요청 초기화 때 적용된다. 운영 DB에는 이번 작업에서 연결하지 않았다. 운영 적용 전 백업 및 ALTER/CREATE 권한 확인, 별도 DB 검증이 필요하다. 오래 열린 탭은 배포 후 새로고침해야 한다.
- 검증: npm test, npm run build 및 git diff --check. PGlite에서 두 행사만 비움, 원본 보관, 새 상품 반복 요청 보존, 7월/다른 사용자 보존, 이전 POST 409, 소유권 제한 및 실패 시 롤백 확인. 실제 브라우저 IndexedDB ARCHIVED 전환·오프라인/온라인 전환·CACHE-01과 운영 적용은 미실행.


## 판매 카드 제작자 표시 후속 조정 (2026-10-14)

제작자 필터 영역의 세로 margin은 모바일·데스크톱 모두 위 8px/아래 12px, 라벨 위 padding은 4px로 축소했다. 판매 상품 카드의 제작자별 색상 배지를 제거하고 상품명 아래 회색 12px 보조 텍스트로 통일했다. 판매 내역의 제작자 색상 표시는 유지한다. 서비스 워커 캐시는 v15로 갱신했다.


## 상품 관리 편집 레이아웃 (2026-10-14)

상품 관리의 가로 표를 상품별 흰색 카드로 변경했다. 이미지, 기본 정보, 가격·재고, 선택 세트 정보를 분리하고 각 입력에 label을 연결한다. 데스크톱은 이미지/입력을 나란히, 모바일은 세로로 배치한다. 등록 상품 수와 저장 중 상태를 표시하고 기본값 추가·초기화 버튼은 목록 아래에 모은다. 기존 입력 자동 저장, 이미지 등록/제거, 상품 추가/삭제 및 기본값 확인·미동기화 차단 동작은 유지한다. 판매 제작자 필터의 filter-options margin-block은 0, 줄 간격은 4px, 버튼 세로 padding은 3px, 최소 높이는 데스크톱30/모바일32px다. 서비스 워커 v16.
