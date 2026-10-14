# 기본 상품 이미지

자산: `public/images/default-product.png`. 내장 image_gen 도구로 생성(2026-10-14). 원본 PNG를 프로젝트에 복사했고 별도 편집은 하지 않았다.

판매 카드와 상품 관리의 이미지 URL이 없거나 로드에 실패하면 표시한다. 기본 파일도 실패하면 텍스트를 표시해 반복 요청을 피한다. 상품 DB에 기본 이미지 URL을 저장하지 않으며, 서비스 워커 v5의 앱 셸 캐시에 포함한다.

최종 생성 프롬프트:

```text
Create a very simple emoticon sticker mascot, NOT a detailed anime illustration. One original chibi SD character with huge round head and tiny simple body, front facing, centered on plain very light gray square. Dark navy-blue hair drawn as ONE flat shape with only 3-4 rounded tufts, two small blue dot/oval eyes, BROWN round eyeglasses with simple thick lines, tiny smiling mouth. Grayscale gray hoodie and tiny mitten hands, rounded compact body. Minimal thick clean charcoal outlines of uniform width. Flat solid fills only, NO gradients, NO shading, NO hair strands, NO textures, NO highlights, NO realistic detail, NO elaborate clothing folds, NO scenery. Like a cute minimal messenger emoji or hand-drawn chat sticker, readable at 48px. Muted near-achromatic palette with only subdued navy hair, blue eyes, brown glasses. Character takes 65 percent of canvas with generous margins. No text, no logos, no border, no watermark.
```
