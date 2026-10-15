# 기본 상품 이미지

자산: `public/images/default-product.svg`. 회색 이미지 아이콘의 정적 SVG다. `ProductImage`가 `No Image` 문구를 HTML 텍스트로 겹쳐 표시하며, 이미지가 작아져도 데스크톱 14pt/모바일 12px를 유지한다. SVG의 접근성 title은 유지한다. 캐릭터 PNG는 제거했다.

판매 카드와 상품 관리에서 이미지 URL이 없거나 로드에 실패하면 표시한다. 기본 파일도 실패하면 No Image 텍스트를 표시한다. 서비스 워커 v27의 앱 셸 캐시에 포함하며 상품 DB에는 기본 이미지 URL을 저장하지 않는다.
