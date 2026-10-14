# MyBooth 로고

- `mybooth-logo.svg`: 밝은 배경용 가로 로고, 460×128.
- `mybooth-logo-dark.svg`: 어두운 배경용 흰색/연두 워드마크, 460×128.
- `mybooth-mark.svg`: Mb 심볼 단독형, 128×128.

연두색 `#BEF264` 타일에 검정 `#111827` Mb 심볼을 배치한다. 기본 워드마크는 검정 My와 파란색 `#2563EB` Booth를 조합한다. 모든 배경은 투명하며 글자는 Segoe UI Bold 윤곽선으로 변환되어 별도 폰트나 외부 리소스가 필요 없다. SVG 비율을 유지하여 확대/축소한다. 어두운 배경에는 dark 파일을 사용한다.

정적 자산 URL은 `/brand/mybooth-logo.svg`, `/brand/mybooth-logo-dark.svg`, `/brand/mybooth-mark.svg`다. 이번 작업은 로고 자산 제작이며 기존 앱 헤더에 적용하거나 서비스 워커 선캐시를 추가하지 않는다.

검증(2026-10-14): npm run build, git diff --check 및 세 SVG의 XML/viewBox/텍스트 노드 없음 검사 통과. 격리된 headless Edge로 기본형을 렌더링해 모노그램과 워드마크 간격을 시각 확인했다. dark/심볼 단독형의 브라우저 시각 검증과 실제 앱 적용은 미실행. API/DB/주문 큐 변경이 없어 npm test 및 판매·오프라인 시나리오는 미실행.
