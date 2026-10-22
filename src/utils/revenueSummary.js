import { settlementMoneyEntries } from './settlementEntries.js';

export const koreanDay = value => {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
};
export function periodRange(period, start, end, now = new Date()) {
  const today = koreanDay(now);
  if (period === 'year') return { start: `${today.slice(0,4)}-01-01`, end: `${today.slice(0,4)}-12-31` };
  if (period === 'month') return { start: `${today.slice(0,7)}-01`, end: `${today.slice(0,7)}-31` };
  if (period === 'custom') return { start, end };
  return { start: '', end: '' };
}
export function revenueSummary(data, settlements, range, eventSettlements = []) {
  const rows = new Map(), events = [];
  let total = 0, count = 0, cash = 0, transfer = 0;
  const getRow = (project, creator) => {
    const key = JSON.stringify([project.id, creator]);
    if (!rows.has(key)) rows.set(key, { projectId: project.id, projectName: project.name, creator, gross: 0, filteredGross: 0, version: 0, deductions: [], payments: [] });
    return rows.get(key);
  };
  for (let index = 0; index < data.projects.length; index++) {
    const project = data.projects[index], state = data.states[index];
    const byId = Object.fromEntries((state.products || []).map(product => [product.id, product]));
    const event = { ...project, amount: 0, count: 0, start: '', end: '' };
    for (const sale of state.sales || []) {
      const day = koreanDay(sale.time);
      const included = (!range.start && !range.end) || Boolean(day && (!range.start || day >= range.start) && (!range.end || day <= range.end));
      if (included) {
        const amount = Number(sale.total || 0); total += amount; count++; event.amount += amount; event.count++;
        if (day && (!event.start || day < event.start)) event.start = day;
        if (day && (!event.end || day > event.end)) event.end = day;
        if (sale.method === 'cash') cash += amount;
        if (sale.method === 'transfer') transfer += amount;
      }
      for (const line of sale.lines || []) for (const entry of settlementMoneyEntries(line, byId, state.bundles || [])) {
        const row = getRow(project, String(entry.creator || '').trim() || '미지정');
        row.gross += entry.amount;
        if (included) row.filteredGross += entry.amount;
      }
    }
    events.push(event);
  }
  for (const settlement of settlements) {
    const project = data.projects.find(project => project.id === settlement.projectId);
    if (project) Object.assign(getRow(project, settlement.creator), settlement);
  }
  for(const closure of eventSettlements.filter(row=>row.closedAt)) {
    const project=data.projects.find(p=>p.id===closure.projectId);if(!project)continue;
    for(const [key,row] of rows)if(row.projectId===project.id)rows.delete(key);
    for(const frozen of closure.snapshot.rows) Object.assign(getRow(project,frozen.creator),settlements.find(r=>r.projectId===project.id&&r.creator===frozen.creator)||{},{...frozen,confirmed:true});
  }
  const creators = new Map();
  for (const row of rows.values()) {
    row.gross = Math.round(row.gross); row.filteredGross = Math.round(row.filteredGross);
    row.confirmed=Boolean(row.confirmed);
    row.expectedGross=row.confirmed?0:row.gross;
    if(!row.confirmed){row.fees=0;row.net=0;}
    row.adjustmentNeeded = row.confirmed ? Math.max(0, row.fees - row.gross):0;
    row.paid = row.payments.reduce((sum, payment) => sum + payment.amount, 0);
    row.pending = row.net - row.paid;
    row.overpaid = row.confirmed ? Math.max(0, row.paid - Math.max(0,row.net)):0;
    const creator = creators.get(row.creator) || { name: row.creator, gross: 0, expectedGross:0, net: 0, paid: 0, pending: 0, fees: 0, overpaid: 0, adjustmentNeeded: 0, rows: [] };
    for (const field of ['gross','expectedGross', 'net', 'paid', 'pending', 'fees', 'overpaid', 'adjustmentNeeded']) creator[field] += row[field];
    creator.rows.push(row); creators.set(row.creator, creator);
  }
  for(const creator of creators.values()){creator.confirmed=creator.rows.some(row=>row.confirmed);creator.hasOpen=creator.rows.some(row=>!row.confirmed);creator.unpaid=creator.rows.some(row=>row.confirmed&&row.net>row.paid);}
  for (const event of events) {
    const matching = [...rows.values()].filter(row => row.projectId === event.id);
    event.confirmed=Boolean(eventSettlements.find(row=>row.projectId===event.id)?.closedAt);
    event.unpaid=matching.some(row=>row.confirmed&&row.net>row.paid);
    event.pending = matching.reduce((sum, row) => sum + row.pending, 0);
    event.overpaid = matching.reduce((sum, row) => sum + row.overpaid, 0);
    event.adjustmentNeeded = matching.reduce((sum, row) => sum + row.adjustmentNeeded, 0);
    event.paid = matching.reduce((sum, row) => sum + row.paid, 0);
  }
  return { total, count, cash, transfer, average: count ? total / count : 0, events: events.sort((a,b) => b.amount-a.amount),
    creators: [...creators.values()].sort((a,b) => b.pending-a.pending || b.gross-a.gross || a.name.localeCompare(b.name,'ko')),
    expectedGross:[...rows.values()].reduce((sum,row)=>sum+row.expectedGross,0),net:[...rows.values()].reduce((sum,row)=>sum+row.net,0),paid:[...rows.values()].reduce((sum,row)=>sum+row.paid,0),
    pending: [...rows.values()].reduce((sum,row) => sum+row.pending,0), fees: [...rows.values()].reduce((sum,row)=>sum+row.fees,0) };
}
export function settlementStatus(row) {
  return !row.confirmed || row.hasOpen ? '정산 중' : row.overpaid > 0 ? '초과 지급 확인' : !row.unpaid && row.pending <= 0 && row.paid > 0 ? '지급 완료' : '마감';
}
export function settlementCsv(creators) {
  const cell = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
  return '\uFEFF' + [['작가','행사','총 판매액','차감 합계','정산 예정','지급 완료','남은 정산','초과 지급','상태'],
    ...creators.flatMap(creator => creator.rows.map(row => [creator.name,row.projectName,row.gross,row.fees,row.net,row.paid,row.pending,row.overpaid,settlementStatus(row)]))]
    .map(row => row.map(value => cell(typeof value === 'string' && /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value)).join(',')).join('\r\n');
}
