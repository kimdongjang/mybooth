# 정산 조회의 잠금·초기화 경계

2026-10-27 운영 제보: 행사 정산 마감 화면의 GET /api/settlements에서 deadlock detected가 표시되었다. 운영 DB의 잠금 그래프를 직접 수집한 재현 기록은 아니다.

## 코드에서 확인한 경로

이전 정산 핸들러는 BEGIN → 부스 권한 검사(계정 행 FOR UPDATE) → ALTER TABLE pos_admins/pos_projects ADD COLUMN IF NOT EXISTS를 실행했다. 같은 계정의 다른 요청이 행 잠금을 기다리면서 테이블 접근 잠금을 보유하면, 첫 요청의 강한 DDL 잠금과 대기 고리가 생길 수 있다. IF NOT EXISTS도 테이블 잠금을 피하지 않는다.

## 수정한 계약

- 업무 트랜잭션 전 pg_attribute/to_regclass로 필수 열과 정산 테이블의 존재를 확인한다. 준비된 스키마의 일반 GET/POST에는 DDL을 실행하지 않는다.
- 누락된 스키마만 별도 초기화 트랜잭션에서 생성한다. 초기화는 전용 advisory transaction lock 이후 다시 존재를 확인하고 필요한 DDL만 실행한 뒤 COMMIT한다. 이 COMMIT 이후에 업무 BEGIN과 계정·부스 권한/행 잠금을 획득한다.
- 40P01(deadlock) 또는 40001(serialization failure)만 전체 ROLLBACK 후 새 연결로 최대 3회 시도한다. actor와 요청 body/requestId를 매번 유지하며 권한·입력·버전 충돌은 재시도하지 않는다. 영수증은 기존 트랜잭션/멱등성 계약을 따른다.
- 재시도를 소진한 DB 충돌은 503과 재시도 가능한 오류를 반환하며 원시 내부 충돌 메시지를 노출하지 않는다. 모든 시도는 연결을 반환한다.

## 검증 범위와 남은 경계

PGlite 회귀로 초기화 COMMIT과 업무 잠금의 순서, 기존 스키마 조회의 DDL 부재, 지급 중 40P01 주입 시 원자 롤백/재시도와 단일 영수증, 40001의 횟수 제한, 권한·입력 오류의 비재시도를 확인한다. 실제 다중 연결 PostgreSQL 잠금 경쟁·운영 요청 재확인은 별도이며 테스트에 운영 DB나 공유된 인증 토큰을 사용하지 않는다. 다른 API의 스키마 초기화와 모든 가능한 잠금 경쟁을 제거했다고 보장하지 않는다.
