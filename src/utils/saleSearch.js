const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('ko-KR');

export function filterSales(sales, { method = 'all', product = '', creator = '', productId = '' }, productEntries, lineCreators) {
  const productQuery = normalize(product);
  const creatorQuery = normalize(creator);
  return sales.filter((sale) => {
    if (method !== 'all' && sale.method !== method) return false;
    if (!productQuery && !creatorQuery && !productId) return true;
    return (sale.lines || []).some((line) => {
      const entries = productEntries(line);
      if (productId && !((line.type === 'product' && line.id === productId) || entries.some(entry => entry.productId === productId))) return false;
      const productMatches = !productQuery || [line.name, line.id, ...entries.flatMap((entry) => [entry.name, entry.productId])].some((name) => normalize(name).includes(productQuery));
      const creatorMatches = !creatorQuery || lineCreators(line).some((name) => normalize(name).includes(creatorQuery));
      return productMatches && creatorMatches;
    });
  });
}
