const normalize = value => String(value ?? '').trim().toLocaleLowerCase('ko-KR');

export function filterInventory(items, { stock = 'all', product = '', creator = '' }) {
  const query = normalize(product);
  const creatorQuery = normalize(creator);
  return items.filter(item => {
    if (stock === 'available' && Number(item.stock) <= 0) return false;
    if (stock === 'empty' && Number(item.stock) > 0) return false;
    const matchesProduct = !query || [item.name, item.productCode, item.id, item.goodsType, item.vtuberName].some(value => normalize(value).includes(query));
    return matchesProduct && (!creatorQuery || normalize(item.creatorName || '제작자 미지정').includes(creatorQuery));
  });
}
