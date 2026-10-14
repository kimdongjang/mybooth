# 기본 상품 이미지

자산: `public/images/default-product.png`. 내장 image_gen 도구로 생성·편집(2026-10-14). 최종 PNG를 프로젝트에 복사했다.

판매 카드와 상품 관리의 이미지 URL이 없거나 로드에 실패하면 표시한다. 기본 파일도 실패하면 텍스트를 표시해 반복 요청을 피한다. 상품 DB에 기본 이미지 URL을 저장하지 않으며, 서비스 워커 v5의 앱 셸 캐시에 포함한다.

최종 이미지는 여성 캐릭터의 얼굴만 오른쪽을 바라보는 반측면(3/4 각도)으로 수정했다. 단순한 이모티콘 스타일을 유지했다. 내장 도구의 최종 편집 프롬프트:

```text
Edit this simple female SD emoticon head to THREE-QUARTER VIEW (3/4 view), turned approximately 35 degrees toward the RIGHT. Both blue eyes must be visible, with the farther eye slightly smaller. BOTH round brown eyeglass lenses are visible, the farther lens slightly narrower. NOT a full side profile, NOT front-facing. HEAD ONLY with no neck, shoulders or body. Retain the dark navy bob hair with a small back bun, muted blue eyes, brown glasses, tiny friendly smile, cute female SD proportions, thick simple charcoal outlines, minimal flat emoticon sticker style, muted colors with light gray square background and generous margin. No detailed illustration, no hair strands, textures, lighting effects or gradients, no text, logo or watermark.
```
