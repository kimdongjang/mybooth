# 작가 중심 재고·부스·행사 구조 전환 로드맵

작성일: 2026-10-22. 이 문서는 목표와 현재 구조를 설명하는 전체 로드맵이다. **실제 작업은 [단계별 진행 현황](artist-booth-transition/README.md)에서 한 단계씩 진행한다.** 01 정책 기준서와 02 호환 기반의 로컬 구현을 완료했다. 02의 기존 실제 자료 이관·보존 대조와 03 작가 연결·본인 열람의 로컬 구현/격리 검증도 완료했다. [이관 결과](artist-booth-transition/02-data-migration.md)를 따르며 동시 운영 검증은 공개 전 별도 범위다. [정책 기준서](artist-booth-transition/policy-baseline.md)가 아래 초기 제안보다 우선한다. 특히 참여 작가와 부스 운영자는 작가의 총재고를 공동 관리한다.

2026-10-22 추가 지침: 04는 납품 승인/예약 대신 작가·운영자의 직접 행사 배정으로 구현했다. 행사 기간은 운영자만 행사 배정·회수·가격/행사 로스를 변경한다. [04 결과](artist-booth-transition/04-implementation.md)가 아래 초기 제안보다 우선한다.

## 실행 문서

2026-10-22 후속 지침: 05 기업 모드는 제외하고 06을 진행했다. [06 결과](artist-booth-transition/06-implementation.md)의 부스별 구형 쓰기 종료/복구를 로컬 구현했다. 실제 DB 종료와 아직 참조 중인 저장 열·이름 별칭의 물리 삭제는 수행하지 않았다. 아래 기업/위탁 및 전면 삭제 제안은 현재 구현 상태가 아니다.

추가 후속: 사용자 기기 확인 후 기존 admin 부스의 [06 실제 종료·보존 대조](artist-booth-transition/06-data-retirement.md)를 완료했다. 물리 열 삭제·앱 배포는 미실행이다. [메뉴 재배치 가이드](artist-booth-transition/07-navigation-and-permissions.md)의 개인 기준 5개 메뉴와 행사별 대리 권한은 다음 구현 제안이다.

| 순서 | 문서 | 범위 |
| --- | --- | --- |
| 01 | [정책 확정](artist-booth-transition/01-policy.md) | 권한·소유권·재고 상태·삭제/보존 정책 결정 |
| 02 | [호환 기반](artist-booth-transition/02-compatibility.md) | 스키마·이관·정산 ID·권한·구형 큐와 데이터 보존 |
| 03 | [작가 연결](artist-booth-transition/03-artist-linking.md) | 미연동 프로필 초대·연결, 본인 이력 열람 |
| 04 | [직접 배정·회수](artist-booth-transition/04-consignment.md) | 작가 재고·부스 참여·직접 행사 배정/회수·기간별 권한·판매 연동 |
| 05 | [기업 모드](artist-booth-transition/05-enterprise.md) | 조직 소유자와 유형별 화면 |
| 06 | [구형 계약 정리](artist-booth-transition/06-retirement.md) | 호환 지원 종료 후 구형 경로 제거 |

[공통 계약·전환·검증 기준](artist-booth-transition/common-contracts-and-validation.md)은 모든 단계에서 해당 범위만 적용한다. 상세 체크박스와 작업 결과는 각 단계 문서에서만 관리한다. 각 문서는 시작 조건·작업 범위·TODO·검증·다음 단계 진입 조건·결과 기록을 포함한다.

## 1. 목표와 전환 원칙

현재의 `부스처럼 사용하는 로그인 계정 → 공통 재고 → 행사`를 다음 구조로 전환한다.

```text
사용자 계정 ── 작가 프로필 소유/관리
     └──── 부스 구성원/운영자

작가 또는 조직(재고 소유자)
  └─ 상품·보유 재고
       └─ 부스 납품·위탁
            └─ 행사 배정
                 └─ 판매·취소 → 행사 정산·지급 기록
```

- 로그인 사용자, 재고 소유자, 부스 운영 권한을 분리한다. 한 사용자가 작가이면서 여러 부스의 운영자일 수 있다.
- 부스는 여러 행사에서 재사용할 수 있는 운영 단위다. 행사는 부스의 행사 참여/판매 단위로 두고, 여러 부스가 참가하는 외부 행사 카탈로그는 우선 범위에서 제외한다.
- 상품의 제작자 표기와 재고의 소유자는 별개다. 기업이 작가 제작 상품을 소유하거나 여러 작가가 공동 제작하는 경우를 계정 소유권과 혼동하지 않는다.
- 기업은 조직 소유자를 사용하고 같은 재고·판매 계약을 재사용한다. 내부 소유자를 실제 작가로 위장하지 않으며, 기업 화면에서는 작가별 위탁·정산 메뉴를 단순화한다.
- 부스 종료·탈퇴 후에도 작가에게 필요한 거래·정산 이력이 남아야 한다. **프로필 테이블 분리만으로는 이력 보존이 보장되지 않는다.** 삭제 정책과 참조 관계까지 바꾼 뒤 완료로 본다.
- 기존 판매·취소·세트·무료 상품·행사 마감·미동기화 주문과 사용자 작업을 보존한다. `pos.html`은 별도 구현이므로 이번 전환 대상에서 제외한다.

## 2. 현재 구현과 변경 지점

| 현재 근거 | 전환할 내용 |
| --- | --- |
| `api/lib/auth.js`, `api/auth.js`의 로그인 계정 | 인증 주체로 유지하고 작가/부스 역할은 별도 관계로 관리 |
| `api/pos.js`의 `pos_projects.admin_id` | 기존 projectId는 행사 ID로 유지하고 행사에 boothId 연결 |
| `pos_inventory`의 `(admin_id, id)`와 상품 JSON | 소유자 식별자 도입, 상품 정보와 장소별 재고 책임 분리 |
| `pos_inventory_links`의 공통 재고→행사 상품 연결 | 소유자 상품→부스 보관 재고→행사 배정 연결로 확장 |
| `creatorName`, `creator_name` 제작자 문자열 | 표시용 이름 보존, 작가·소유자·정산 수취인 ID 별도 도입 |
| `api/settlements.js`의 `(admin_id, project_id, creator)` 정산 키 | 이름 대신 안정적인 수취인 ID 사용, 기존 차감·지급·요청 영수증 보존 |
| `api/lib/eventSettlement.js`, `src/utils/eventSettlement.js` | 마감 스냅샷과 비용 배분에 당시 소유자/수취인 식별자 포함 |
| `src/database/*`, `src/sync/syncService.ts`의 projectId 기반 주문/상태 | 사용자·부스·행사 문맥 격리 및 구형 큐 호환 |
| `api/lib/accountInventory.js`와 계정 탈퇴·복원 처리 | 공유 데이터에 대한 일괄 삭제/복원 방지 |
| `src/App.jsx`, `src/pages/*`, `src/hooks/usePageRoute.js` | 작가/부스 문맥 선택과 역할별 화면 연결 |
| `api/product-images.js`, `src/utils/uploadProductImage.js` | 이미지 업로드·연결 권한도 새 소유권에 맞춰 변경 |
