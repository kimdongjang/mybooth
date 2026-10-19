import { productNameFromFields } from './productDisplay';

export function recentProductValues(products, field) {
  const newest = [...products].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return [...new Set(newest.map(product => String(product[field] || '').trim()).filter(Boolean))];
}

export function productEditDraft(product) {
  return { name: product.name || productNameFromFields(product), vtuberName: product.vtuberName || '', goodsType: product.goodsType || '', creatorName: product.creatorName || '', genre: product.genre || '', price: String(product.price ?? 0) };
}

export function productEditPatch(draft) {
  const price = Number(draft.price);
  if (!draft.name.trim() || !draft.goodsType.trim() || !String(draft.price).trim() || !Number.isSafeInteger(price) || price < 0) throw new Error('상품 이름, 굿즈 종류와 0 이상의 정수 판매가를 입력해주세요.');
  if (typeof draft.genre !== 'string' || draft.genre.length > 200) throw new Error('장르는 200자 이내로 입력해주세요.');
  return { genre: draft.genre.trim(), name: draft.name.trim(), vtuberName: draft.vtuberName.trim(), goodsType: draft.goodsType.trim(), creatorName: draft.creatorName.trim(), price };
}

export function applyProductEdit(products, id, patch) {
  if (!products.some(product => product.id === id)) throw new Error('상품이 없습니다. 목록을 다시 확인해주세요.');
  return products.map(product => product.id === id ? { ...product, ...patch } : product);
}

export function productStockDraft(product) {
  return { initialStockQty: String(product.initialStockQty ?? 0), stockQty: String(product.stockQty ?? product.stock ?? 0) };
}

export function productStockPatch(draft, baseline, product, soldQty) {
  const initialStockQty = Number(draft.initialStockQty);
  if (!String(draft.initialStockQty).trim() || !Number.isSafeInteger(initialStockQty) || initialStockQty < 0) throw new Error('초기재고는 0 이상의 정수로 입력해주세요.');
  if (initialStockQty === Number(baseline.initialStockQty)) return {};
  if (!Number.isSafeInteger(soldQty) || soldQty < 0 || initialStockQty < soldQty) throw new Error('초기재고는 판매수량 이상으로 입력해주세요.');
  const latest = productStockDraft(product);
  if (['initialStockQty', 'stockQty'].some(field => Number(latest[field]) !== Number(baseline[field]))) throw new Error('재고가 변경되었습니다. 새로고침 후 최신 수량을 확인해주세요.');
  const stockQty = initialStockQty - soldQty;
  return { initialStockQty, stockQty, stock: stockQty };
}
