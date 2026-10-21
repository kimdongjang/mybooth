const normalize = value => String(value ?? '').trim().toLocaleLowerCase('ko-KR');

export function registrationDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function filterInventory(items, { registeredDate = '', stock = 'all', product = '', creator = '', creatorExact = '', goodsType = '', genre = '', event = '' }) {
  const query = normalize(product);
  const creatorQuery = normalize(creator);
  return items.filter(item => {
    if (registeredDate && registrationDate(item.createdAt) !== registeredDate) return false;
    if (creatorExact && (item.creatorName || '미지정') !== creatorExact) return false;
    if (goodsType && (item.goodsType || '미지정') !== goodsType) return false;
    if (genre && (item.genre || '미지정') !== genre) return false;
    if (event && !(item.allocations || []).some(row => String(row.project_id) === event)) return false;
    if (stock === 'available' && Number(item.remainingStock ?? item.stock) <= 0) return false;
    if (stock === 'empty' && Number(item.remainingStock ?? item.stock) > 0) return false;
    const matchesProduct = !query || [item.name, item.productNumber, item.genre, item.productCode, item.id, item.goodsType, item.vtuberName].some(value => normalize(value).includes(query));
    return matchesProduct && (!creatorQuery || normalize(item.creatorName || '제작자 미지정').includes(creatorQuery));
  });
}
