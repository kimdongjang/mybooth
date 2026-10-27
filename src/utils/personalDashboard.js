import {koreanDay} from './revenueSummary.js';

const numeric=value=>value!=null&&Number.isFinite(Number(value))?Number(value):null;
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
const timestamp=value=>{const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:0;};
const days=(from,to)=>Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000);
export function countDashboardWaiting(orders,actorId,projectId) {
 return orders.filter(order=>order.projectId===projectId&&['PENDING','FAILED','SYNCING'].includes(order.syncStatus)
  &&(order.actorId||order.payload?.actorId)===actorId&&(!order.payload?.actorId||order.payload.actorId===actorId)).length;
}
export function dashboardEvents(data,events=[],today=koreanDay(new Date())) {
 const inventory=data?.inventory||[],merged=new Map(events.map(event=>[event.id,{...event}]));
 for(const history of data?.events||[]){const existing=merged.get(history.projectId)||{};merged.set(history.projectId,{...existing,id:history.projectId,name:existing.name||history.eventName,boothName:existing.boothName||history.boothName,history});}
 for(const schedule of data?.stockEvents||[]){const event=merged.get(schedule.id);if(event)event.schedule=schedule;}
 return [...merged.values()].map(event=>{
  const p=event.permissions||{},operator=Boolean(p.canManage),summary=operator?event.summary:null;
  const schedule={starts_on:event.startsOn,ends_on:event.endsOn,...event.schedule};
  const closed=Boolean(event.history?.closedAt||schedule.closed_at||summary?.closedAt);
  const status=event.archivedAt||schedule.archived_at||schedule.ends_on&&schedule.ends_on<today||!schedule.starts_on&&!schedule.ends_on&&closed?'ended':schedule.starts_on&&schedule.starts_on>today?'upcoming':schedule.starts_on&&schedule.ends_on?'active':'unscheduled';
  const allocations=inventory.flatMap(item=>(item.allocations||[]).filter(row=>row.projectId===event.id));
  const sales=(event.history?.sales||[]).filter(sale=>!sale.voided),ownRows=event.history?.rows||[];
  const owns=Boolean(event.history||p.ownerIds?.length||allocations.length);
  const latest=Math.max(timestamp(summary?.lastSaleAt),...sales.map(sale=>timestamp(sale.time)),0);
  const ownSold=sum(allocations,'sold'),ownRemaining=sum(allocations,'remaining');
  const stock=operator&&summary&&numeric(summary.initialStock)!=null&&numeric(summary.remainingStock)!=null?{remaining:Number(summary.remainingStock),sold:Math.max(0,Number(summary.initialStock)-Number(summary.remainingStock)),label:'소진',total:Number(summary.initialStock)}:
   allocations.length?{remaining:ownRemaining,sold:ownSold,label:'판매',total:Math.max(sum(allocations,'initial'),ownSold+ownRemaining)}:null;
  const metrics=operator&&summary?{gross:numeric(summary.total),transactions:numeric(summary.sales),products:numeric(summary.products),allocated:numeric(summary.initialStock),artists:numeric(summary.artistCount)}:
   {gross:event.history?sum(sales.flatMap(sale=>sale.items),'amount'):null,transactions:event.history?sales.length:null,products:owns?allocations.length:null,allocated:owns?sum(allocations,'initial'):null,artists:null};
  const net=operator&&closed&&summary?.settlementNet!=null?summary.settlementNet:ownRows.length?sum(ownRows,'net'):null;
  const paid=operator&&closed&&summary?.paid!=null?summary.paid:ownRows.length?sum(ownRows,'paid'):null;
  const pending=operator&&closed&&summary?.pending!=null?summary.pending:ownRows.length?sum(ownRows,'pending'):null;
  const dayLabel=status==='upcoming'?`D-${days(today,schedule.starts_on)}`:status==='active'?`진행 ${days(schedule.starts_on,today)+1}일차`:status==='ended'&&schedule.ends_on?`종료 ${Math.max(0,days(schedule.ends_on,today))}일차`:'';
  return {...event,p,operator,summary,schedule,closed,status,endedAt:schedule.ends_on||event.archivedAt||summary?.closedAt||event.history?.closedAt||schedule.closed_at,allocations,sales,latest,stock,metrics,net,paid,pending,dayLabel,
   lowStock:operator&&summary?.lowStockProducts!=null?Number(summary.lowStockProducts):allocations.filter(row=>Number(row.remaining)>0&&Number(row.remaining)<=3).length,
   netScope:operator&&closed&&summary?.settlementNet!=null?'event':'own',
   canReport:Boolean(p.canSettle||p.canReadOwnHistory||p.ownerIds?.length||event.history),waiting:data?.waitingOrders?.[event.id]};
 });
}

export function dashboardFocus(events,pinnedProjectId='') {
 const active=events.filter(event=>event.status==='active').sort((a,b)=>b.latest-a.latest||String(b.schedule.starts_on).localeCompare(String(a.schedule.starts_on))||a.name.localeCompare(b.name,'ko'));
 const upcoming=events.filter(event=>event.status==='upcoming').sort((a,b)=>a.schedule.starts_on.localeCompare(b.schedule.starts_on)||a.name.localeCompare(b.name,'ko'));
 const ended=events.filter(event=>event.status==='ended').sort((a,b)=>timestamp(b.endedAt)-timestamp(a.endedAt)||a.name.localeCompare(b.name,'ko'));
 const unknown=events.filter(event=>event.status==='unscheduled').sort((a,b)=>a.name.localeCompare(b.name,'ko'));
 const pinned=events.find(event=>event.id===pinnedProjectId);
 return {choices:pinned?[pinned]:active.length?active:upcoming.length?[upcoming[0]]:ended.length?[ended[0]]:[],upcoming,ended,unknown};
}

export function dashboardAlerts(events,warehouse=0) {
 const alerts=events.flatMap(event=>{
  const rows=[];
  if(event.closed&&event.net!=null&&event.net<0)rows.push({key:`negative:${event.id}`,type:'negative',event});
  if(event.status==='ended'&&event.stock?.remaining>0)rows.push({key:`recovery:${event.id}`,type:'recovery',event});
  if(event.closed&&event.pending>0)rows.push({key:`pending:${event.id}`,type:'pending',event});
  return rows;
 });
 const eligible=events.filter(event=>!event.closed&&['active','upcoming'].includes(event.status)
  &&(event.operator||event.p.canConfigure||event.p.ownerIds?.length||event.allocations.length));
 const groups=dashboardFocus(eligible),target=groups.choices[0];
 if(warehouse>0&&target)alerts.push({key:'allocation',type:'allocation',event:target});
 const priority={recovery:0,allocation:1,pending:2,negative:3};
 return alerts.sort((a,b)=>priority[a.type]-priority[b.type]);
}
