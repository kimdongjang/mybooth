import { settlementEntries } from './settlementEntries.js';

export async function loadDashboard(request, includeInventory = true) {
  const [list, inventory] = await Promise.all([
    request('/api/pos'),
    includeInventory ? request('/api/pos', { method: 'POST', body: JSON.stringify({ action: 'listInventory', payload: {} }) }) : Promise.resolve({ inventory: [] }),
  ]);
  const states = new Array(list.projects.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, list.projects.length) }, async () => {
    while (cursor < list.projects.length) {
      const index = cursor++;
      states[index] = await request(`/api/pos?projectId=${encodeURIComponent(list.projects[index].id)}`);
    }
  }));
  return { projects: list.projects, inventory: inventory.inventory, states };
}

export function dashboardSummary({ projects, inventory, states }) {
  let total = 0, transactions = 0, cash = 0, transfer = 0;
  const creators = new Map(), goods = new Map();
  const events = projects.map((project, index) => {
    const state = states[index];
    const products = Object.fromEntries((state.products || []).map(product => [product.id, product]));
    let amount = 0, sold = 0;
    for (const sale of state.sales || []) {
      amount += Number(sale.total || 0); transactions++;
      if (sale.method === 'cash') cash += Number(sale.total || 0);
      if (sale.method === 'transfer') transfer += Number(sale.total || 0);
      for (const line of sale.lines || []) for (const entry of settlementEntries(line, products, state.bundles || [])) {
        sold += entry.qty;
        const name = String(entry.creator || '').trim() || '미지정';
        const creator = creators.get(name) || { name, amount: 0, qty: 0, events: new Map() };
        creator.amount += entry.amount; creator.qty += entry.qty;
        const event = creator.events.get(project.id) || { id: project.id, name: project.name, amount: 0, qty: 0 };
        event.amount += entry.amount; event.qty += entry.qty;
        creator.events.set(project.id, event); creators.set(name, creator);
        const productName = String(entry.name || '').trim() || '알 수 없는 굿즈';
        const good = goods.get(productName) || { name: productName, amount: 0, qty: 0 };
        good.amount += entry.amount; good.qty += entry.qty; goods.set(productName, good);
      }
    }
    total += amount;
    const remaining = (state.products || []).reduce((sum, product) => sum + Number(product.stockQty ?? product.stock ?? 0), 0);
    const denominator = sold + remaining;
    return { ...project, amount, transactions: (state.sales || []).length, remaining, sold, sellThrough: denominator ? sold / denominator * 100 : 0 };
  }).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ko'));
  const stock = inventory.reduce((sum, item) => ({
    sold: sum.sold + (item.history || []).reduce((qty, row) => qty + Number(row.soldQty || 0), 0),
    allocated: sum.allocated + (item.allocations || []).reduce((qty, row) => qty + Number(row.stock || 0), 0),
    unallocated: sum.unallocated + Number(item.stock || 0),
  }), { sold: 0, allocated: 0, unallocated: 0 });
  const alerts = [];
  for (const project of events) if (project.archivedAt && project.remaining > 0) alerts.push({ key: `return:${project.id}`, text: `${project.name} · 보관 행사 잔여 ${project.remaining.toLocaleString()}개 회수 확인`, href: '#/inventory' });
  for (const item of inventory) if (Number(item.stock) > 0) {
    const rows = (item.allocations || []).filter(row => !row.archived_at && row.is_active !== false && Number(row.stock) <= 3);
    if (rows.length) alerts.push({ key: `stock:${item.id}`, text: `${item.name} · ${rows.length}개 행사 재고 3개 이하, 미분배 ${Number(item.stock).toLocaleString()}개`, href: `#/inventory/${encodeURIComponent(item.id)}` });
  }
  const rank = values => [...values].sort((a, b) => b.amount - a.amount || b.qty - a.qty || a.name.localeCompare(b.name, 'ko'));
  return { total, transactions, cash, transfer, average: transactions ? total / transactions : 0,
    activeEvents: projects.filter(project => !project.archivedAt).length, events, stock, alerts,
    creators: rank(creators.values()).map(creator => ({ ...creator, events: rank(creator.events.values()) })), goods: rank(goods.values()).slice(0, 5) };
}
