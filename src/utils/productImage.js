export const PRODUCT_IMAGE_MAX_EDGE = 256;
export const PRODUCT_IMAGE_INPUT_LIMIT = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_HELP = 'JPG · PNG · WebP / 원본 최대 5MB · 긴 변 256px로 자동 축소';

// Keep the whole product visible, including transparency, without enlarging small inputs.
export async function prepareProductImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > PRODUCT_IMAGE_INPUT_LIMIT) {
    throw new Error('JPG, PNG, WebP 이미지를 5MB 이하로 선택해주세요.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, PRODUCT_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지 변환을 지원하지 않는 브라우저입니다.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob || blob.size > PRODUCT_IMAGE_INPUT_LIMIT) throw new Error('이미지를 압축하지 못했습니다. 다른 이미지를 선택해주세요.');
    const extension = blob.type === 'image/webp' ? 'webp' : 'png';
    return new File([blob], `product-thumbnail.${extension}`, { type: blob.type });
  } catch (error) {
    throw new Error(error.message || '이미지를 읽을 수 없습니다. 다른 이미지를 선택해주세요.');
  } finally {
    bitmap?.close();
  }
}
