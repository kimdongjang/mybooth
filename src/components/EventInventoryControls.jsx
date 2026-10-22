import LoadingState from './LoadingState';
import StockMovementForm from './StockMovementForm';
import { useEffect, useState } from 'react';
import { Quantity } from './PosUI';

export default function EventInventoryControls({ adminId, projectId, product, api }) {
  const [loaded,setLoaded]=useState(false);
  const [item, setItem] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true; setLoaded(false); setError('');
    api('listInventory').then(async data => {
      const found = data.inventory.find(row => row.id === product.inventoryId || row.allocations.some(allocation => allocation.project_id === projectId && allocation.product_id === product.id));
      if (!active) return; setLoaded(true); setItem(found || null);
      if (found && !product.inventoryId) await api('getEventState', { projectId, apply: true });
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [adminId,projectId,product.inventoryId,product.inventoryVersion,product.stockQty]);
  const allocation = item?.allocations.find(row => row.project_id === projectId && row.product_id === product.id);
  const sold = item?.history.find(row => row.projectId === projectId && row.productId === product.id)?.soldQty || 0;
  return <section className="event-inventory-controls"><h4>행사 배정 재고 상세</h4>
    {error && <p role="alert">{error}</p>}
    <div className="product-stock-grid event-inventory-grid"><Quantity label="총재고" value={item?.totalStock ?? 0} /><Quantity label="행사 배정 수량" value={allocation?.initial_stock ?? product.initialStockQty ?? 0} />
      <Quantity label="판매 수량" value={sold} /><Quantity label="남은 수량" value={allocation?.stock ?? product.stockQty ?? 0} /></div>
    {item && <StockMovementForm adminId={adminId} api={api} items={[item]} inventoryId={item.id} projectId={projectId} productId={product.id} onChange={data=>setItem(data.inventory.find(i=>i.id===item.id))} />}
    {!loaded && !error && <LoadingState />}
  </section>;
}
