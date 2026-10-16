import { productNameFromFields } from './productDisplay';

export function recentProductValues(products, field) {
  const newest = [...products].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return [...new Set(newest.map(product => String(product[field] || '').trim()).filter(Boolean))];
}

export function productEditDraft(product) {
  return { vtuberName: product.vtuberName || '', goodsType: product.goodsType || '', creatorName: product.creatorName || '', price: String(product.price ?? 0) };
}

export function productEditPatch(draft) {
  const price = Number(draft.price);
  if (!draft.goodsType.trim() || !String(draft.price).trim() || !Number.isSafeInteger(price) || price < 0) throw new Error('굿즈 종류와 0 이상의 정수 판매가를 입력해주세요.');
  return { vtuberName: draft.vtuberName.trim(), goodsType: draft.goodsType.trim(), creatorName: draft.creatorName.trim(), price };
}

export function applyProductEdit(products, id, patch) {
  if (!products.some(product => product.id === id)) throw new Error('상품이 없습니다. 목록을 다시 확인해주세요.');
  return products.map(product => product.id === id ? { ...product, ...patch, name: productNameFromFields({ ...product, ...patch }) } : product);
}
