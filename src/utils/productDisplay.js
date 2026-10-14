export const uid = () => Math.random().toString(36).slice(2, 9);
export const won = (n) => Number(n || 0).toLocaleString('ko-KR');
export const creatorNameOf = (product) => product?.creatorName?.trim() || '미지정';
export const productNameFromFields = (product) => [product.vtuberName, product.goodsType, product.creatorName ? `(${product.creatorName})` : ''].filter(Boolean).join(' ') || product.name || '새 굿즈';
export const productNameWithoutCreator = (product) => String(product?.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || product?.name || '';
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
