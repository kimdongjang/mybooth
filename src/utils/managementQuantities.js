export function managementQuantities(sales, bundles) {
  const result = { products: new Map(), bundles: new Map() };
  for (const sale of sales) for (const line of sale.lines || []) {
    const qty = Number(line.qty) || 0;
    if (line.type === 'product') result.products.set(line.id, (result.products.get(line.id) || 0) + qty);
    if (line.type === 'bundle') {
      result.bundles.set(line.id, (result.bundles.get(line.id) || 0) + qty);
      for (const item of line.subItems || bundles.find((b) => b.id === line.id)?.items || []) result.products.set(item.productId, (result.products.get(item.productId) || 0) + Number(item.qty) * qty);
    }
  }
  return result;
}

export function managementBundleStock(bundle, products) {
  const required = new Map();
  for (const item of bundle.items) required.set(item.productId, (required.get(item.productId) || 0) + Number(item.qty));
  if (!required.size) return 0;
  return Math.max(0, Math.min(...[...required].map(([id, qty]) => {
    const product = products.find((p) => p.id === id);
    return product && Number.isInteger(qty) && qty > 0 ? Math.floor(Number(product.stockQty ?? product.stock ?? 0) / qty) : 0;
  })));
}

