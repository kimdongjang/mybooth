import { put } from '@vercel/blob/client';

export async function uploadProductImage(projectId, productId, image) {
  return uploadImage(`products/${encodeURIComponent(projectId)}/${encodeURIComponent(productId)}`, { projectId, productId }, image);
}

export function uploadInventoryImage(adminId, inventoryId, image) {
  return uploadImage(`inventory/${encodeURIComponent(adminId)}/${encodeURIComponent(inventoryId)}`, { inventoryId }, image);
}

async function uploadImage(prefix, scope, image) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.type];
  const pathname = `${prefix}/${crypto.randomUUID()}.${extension}`;
  const response = await fetch('/api/product-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('pos_admin_token')}` },
    body: JSON.stringify({ type: 'blob.generate-client-token', payload: {
      pathname, clientPayload: JSON.stringify(scope), multipart: false,
    } }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.clientToken?.startsWith('vercel_blob_client_')) {
    if (response.status === 401) throw new Error('인증에 실패했습니다. 다시 로그인한 뒤 이미지를 저장해주세요.');
    throw new Error(data?.code === 'BLOB_NOT_CONFIGURED'
      ? '이미지 저장소가 연결되지 않았습니다. 관리자에게 이미지 저장소 설정을 요청해주세요.'
      : `이미지 업로드 권한을 받지 못했습니다. 잠시 후 다시 시도해주세요. (${response.status})`);
  }
  return put(pathname, image, { access: 'public', contentType: image.type, token: data.clientToken });
}
