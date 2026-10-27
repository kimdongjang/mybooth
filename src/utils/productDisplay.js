export const uid = () => Math.random().toString(36).slice(2, 9);
export const won = (n) => Number(n || 0).toLocaleString('ko-KR');
export const creatorNameOf = (product) => product?.creatorName?.trim() || '미지정';
// Event attribution is separate from the original inventory owner and sale snapshots.
export const eventCreatorNameOf = (product) => product && Object.hasOwn(product, 'eventCreator')
  ? product.eventCreator?.name?.trim() || '미연결'
  : creatorNameOf(product);
export const productNameFromFields = (product) => [product.vtuberName, product.goodsType, product.creatorName ? `(${product.creatorName})` : ''].filter(Boolean).join(' ') || product.name || '새 굿즈';
export const productNameWithoutCreator = (product) => {
  const name = String(product?.name || '').trim();
  const suffix = product?.creatorName?.trim() ? `(${product.creatorName.trim()})` : '';
  return suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length).trim() || name : name;
};
export const normalizeProductForClient = (product) => {
  const stock = Number(product?.stock ?? product?.stockQty ?? 0) || 0;
  const stockQty = Number(product?.stockQty ?? product?.stock ?? stock) || 0;

  return {
    ...product,
    stock,
    stockQty,
    price: Number(product?.price ?? 0) || 0,
    name: product?.name || productNameFromFields(product || {}),
  };
};

export const compareProductSaleNumber = (a, b) => (Number(a.saleNumber) || Number.MAX_SAFE_INTEGER) - (Number(b.saleNumber) || Number.MAX_SAFE_INTEGER) || String(a.productCode || a.id).localeCompare(String(b.productCode || b.id), 'ko-KR', { numeric: true });
