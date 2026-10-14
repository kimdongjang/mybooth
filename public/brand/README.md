# MyBooth 로고

- `mybooth-logo.svg`: 밝은 배경용 검정/파란 워드마크, 296×86.
- `mybooth-logo-dark.svg`: 어두운 배경용 흰색/연두 워드마크, 296×86.

Mb 심볼과 타일을 제거하고 MyBooth 워드마크만 제공한다. 기본형은 검정 `#111827` My와 파란색 `#2563EB` Booth, 어두운 배경용은 흰색 My와 연두색 `#BEF264` Booth를 조합한다. 배경은 투명하며 글자는 Segoe UI Bold 윤곽선으로 변환되어 외부 폰트가 필요 없다. SVG 비율을 유지하여 확대/축소한다.

정적 자산 URL은 `/brand/mybooth-logo.svg`, `/brand/mybooth-logo-dark.svg`다. 앱 헤더 적용과 서비스 워커 선캐시는 포함하지 않는다.

검증(2026-10-14): npm run build, git diff --check 및 두 SVG의 XML/viewBox/심볼 제거 검사 통과. 기본형은 심볼 제거 전 브라우저에서 글자 형태와 간격을 확인했으며 최종 워드마크 단독형의 브라우저 시각 확인은 미실행. API/DB/주문 큐 변경이 없어 npm test 및 판매·오프라인 시나리오는 미실행.
