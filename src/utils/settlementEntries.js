import { creatorNameOf, productNameWithoutCreator } from './productDisplay.js';

// Payment obligations must sum to whole won even when bundle weights are fractional.
export function settlementMoneyEntries(line, productsById, bundles) {
  const entries = settlementEntries(line, productsById, bundles);
  const ranked = entries.map((entry, index) => ({ index, fraction: entry.amount - Math.floor(entry.amount) })).sort((a,b) => b.fraction-a.fraction || a.index-b.index);
  const target = Math.round(entries.reduce((sum,entry) => sum+entry.amount,0));
  const rounded = entries.map(entry => ({ ...entry, amount: Math.floor(entry.amount) }));
  const remainder = target-rounded.reduce((sum,entry)=>sum+entry.amount,0);
  for (let i=0;i<remainder;i++) rounded[ranked[i].index].amount++;
  return rounded;
}

export function settlementEntries(line, productsById, bundles) {
    if (line.type === 'product') {
      const product = productsById[line.id];
      return [{
        productId: line.id,
        name: line.name || productNameWithoutCreator(product),
        creator: line.creatorName || creatorNameOf(product),
        qty: Number(line.qty || 0),
        amount: Number(line.unitPrice || 0) * Number(line.qty || 0),
      }];
    }
    if (line.type === 'bundle') {
      const bundle = bundles.find((b) => b.id === line.id);
      const items = line.subItems || bundle?.items || [];
      const lineQty = Number(line.qty || 0);
      const lineTotal = Number(line.unitPrice || 0) * lineQty;
      const weights = items.map((item) => {
        const product = productsById[item.productId];
        const itemQty = Number(item.qty || 0);
        return Math.max(0, Number(item.unitPrice ?? product?.price ?? 0) * itemQty) || itemQty;
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      return items.map((item, index) => {
        const product = productsById[item.productId];
        return {
          productId: item.productId,
          name: item.name || productNameWithoutCreator(product) || product?.name || '알 수 없는 굿즈',
          creator: item.creatorName || creatorNameOf(product),
          qty: Number(item.qty || 0) * lineQty,
          amount: lineTotal * (weights[index] / totalWeight),
        };
      });
    }
    return [];
}
