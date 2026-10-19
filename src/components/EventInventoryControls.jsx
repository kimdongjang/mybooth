import { useEffect, useState } from 'react';
import { Quantity } from './PosUI';

export default function EventInventoryControls({ adminId, projectId, product, api }) {
  const [item, setItem] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true; setError('');
    api('listInventory').then(async data => {
      const found = data.inventory.find(row => row.id === product.inventoryId || row.allocations.some(allocation => allocation.project_id === projectId && allocation.product_id === product.id));
      if (!active) return; setItem(found || null);
      if (found && !product.inventoryId) await api('getEventState', { projectId, apply: true });
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [adminId,projectId,product.inventoryId,product.inventoryVersion,product.stockQty]);
  const allocation = item?.allocations.find(row => row.project_id === projectId && row.product_id === product.id);
  const sold = item?.history.find(row => row.projectId === projectId && row.productId === product.id)?.soldQty || 0;
  return <section className="event-inventory-controls"><h4>이 행사의 판매 재고</h4>
    {error && <p role="alert">{error}</p>}
    <div className="product-stock-grid"><Quantity label="총재고" value={item?.totalStock ?? 0} /><Quantity label="행사 배정 수량" value={allocation?.initial_stock ?? product.initialStockQty ?? 0} />
      <Quantity label="판매 수량" value={sold} /><Quantity label="남은 수량" value={allocation?.stock ?? product.stockQty ?? 0} /></div>
    {item && <a className="management-back" href={`#/inventory/${encodeURIComponent(item.id)}`}>공통 재고 상세에서 수량 관리 →</a>}
    {!item && !error && <p>공통 재고 정보를 불러오는 중이거나 연결된 원본이 없습니다.</p>}
  </section>;
}
