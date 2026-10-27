import { settlementMoneyEntries } from './settlementEntries.js';
const invalid = message => { throw Object.assign(new Error(message), {status:400}); };
export function validateEventCosts(costs) {
  if (!Array.isArray(costs) || costs.length > 50) invalid('비용은 최대 50개까지 입력해주세요.');
  return costs.map(cost => {
    if (!cost || typeof cost.label !== 'string' || !cost.label.trim() || cost.label.length > 80 || typeof cost.memo !== 'string' || cost.memo.length > 500 || !['equal','ratio'].includes(cost.split) || !['fixed','percent'].includes(cost.type) || !Number.isSafeInteger(cost.value) || cost.value < 0 || cost.value > (cost.type === 'percent' ? 10000 : 2147483647)) invalid('비용명, 금액·수수료율, 분담 방식을 확인해주세요.');
    return {label:cost.label.trim(),memo:cost.memo.trim(),split:cost.split,type:cost.type,value:cost.value};
  });
}
// Largest remainder allocation: every won is assigned once, ties use creator order.
function distribute(amount, weights) {
  const total=weights.reduce((sum,n)=>sum+BigInt(n),0n);
  if (!weights.length) return [];
  if (!total) return distribute(amount,weights.map(()=>1));
  const shares=weights.map((weight,index)=>{const numerator=BigInt(amount)*BigInt(weight);return {index,value:Number(numerator/total),remainder:numerator%total};});
  let left=amount-shares.reduce((sum,row)=>sum+row.value,0);
  for(const row of [...shares].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder? -1:1)) if(left-->0)row.value++;
  return shares.map(row=>row.value);
}
export function eventSettlementPreview({products=[],bundles=[],sales=[]}, costs=[], settlements=[]) {
  const byId=Object.fromEntries(products.map(p=>[p.id,p]));
  const amounts=new Map();
  const name=value=>String(value || '').trim() || '미지정';
  for(const product of products) if(product.isActive!==false && product.is_active!==false) amounts.set(name(product.settlementCreator ?? product.creatorName ?? product.creator_name),0);
  for(const sale of sales) for(const line of sale.lines || []) for(const entry of settlementMoneyEntries(line,byId,bundles)) amounts.set(name(entry.creator),(amounts.get(name(entry.creator))||0)+entry.amount);
  for(const record of settlements) if(!amounts.has(record.creator)) amounts.set(record.creator,0);
  const rows=[...amounts].sort(([a],[b])=>a.localeCompare(b,'ko')).map(([creator,gross])=>({creator,gross:Math.round(gross),fees:0,shares:[]}));
  const gross=rows.reduce((sum,row)=>sum+row.gross,0);
  if(!Number.isSafeInteger(gross) || gross<0)invalid('판매액 범위를 확인해주세요.');
  const items=validateEventCosts(costs).map(cost=>{
    const amount=cost.type==='percent'?Number((BigInt(gross)*BigInt(cost.value)+5000n)/10000n):cost.value;
    const shares=distribute(amount,rows.map(row=>cost.split==='equal'?1:row.gross));
    if(amount && !rows.length)invalid('비용을 분담할 참여 제작자가 없습니다.');
    rows.forEach((row,i)=>{row.fees+=shares[i];row.shares.push({label:cost.label,amount:shares[i]});});
    return {...cost,amount};
  });
  for(const row of rows){
    const legacy=settlements.find(s=>s.creator===row.creator)?.deductions || [];
    row.shares.push(...legacy);row.fees+=legacy.reduce((sum,item)=>sum+item.amount,0);row.net=row.gross-row.fees;
  }
  return {gross,costs:items,rows,fees:rows.reduce((sum,row)=>sum+row.fees,0),net:rows.reduce((sum,row)=>sum+row.net,0),transactions:sales.length};
}
