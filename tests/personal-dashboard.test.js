import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardEvents,dashboardFocus,countDashboardWaiting,dashboardAlerts,dashboardPastEvents,settlementDisplay} from '../src/utils/personalDashboard.js';

const event=(id,start,end,extra={})=>({id,name:id,startsOn:start,endsOn:end,permissions:{canManage:true,canSell:true,canConfigure:true,canSettle:true},...extra});
const today='2026-10-27';

test('focus prefers most recent live sale, then nearest upcoming event, then latest ended event',()=>{
 const events=[event('live-old','2026-10-25','2026-10-28',{summary:{lastSaleAt:'2026-10-26T10:00:00Z'}}),event('future-late','2026-12-05','2026-12-06'),event('live-new','2026-10-26','2026-10-28',{summary:{lastSaleAt:'2026-10-27T10:00:00Z'}}),event('future-near','2026-11-01','2026-11-02'),event('past-old','2026-09-01','2026-09-02'),event('past-new','2026-10-01','2026-10-02')];
 const model=dashboardEvents({},events,today);
 assert.deepEqual(dashboardFocus(model).choices.map(row=>row.id),['live-new','live-old']);
 assert.equal(dashboardFocus(model.filter(row=>row.status!=='active')).choices[0].id,'future-near');
 assert.equal(dashboardFocus(model.filter(row=>row.status==='ended')).choices[0].id,'past-new');
 assert.equal(model.find(row=>row.id==='live-new').dayLabel,'진행 2일차');
 assert.equal(model.find(row=>row.id==='future-near').dayLabel,'D-5');
});

test('artist metrics ignore whole-event summaries and preserve own snapshot amounts and stock',()=>{
 const data={inventory:[{allocations:[{projectId:'event',initial:10,sold:2,remaining:7}]}],events:[{projectId:'event',eventName:'event',rows:[{net:-500,paid:0,pending:0}],sales:[{time:'2026-10-27T00:00:00Z',items:[{amount:1000,quantity:2}]},{time:'2026-10-27T01:00:00Z',voided:true,items:[{amount:999999}]}]}]};
 const [row]=dashboardEvents(data,[event('event','2026-10-26','2026-10-28',{permissions:{ownerIds:['owner'],canReadOwnHistory:true},summary:{total:999999,sales:100,initialStock:1000,remainingStock:999,artistCount:50}})],today);
 assert.equal(row.operator,false);assert.equal(row.metrics.gross,1000);assert.equal(row.metrics.transactions,1);assert.equal(row.metrics.artists,null);
 assert.equal(row.stock.sold,2);assert.equal(row.stock.remaining,7);assert.equal(row.stock.total,10);assert.equal(row.net,-500);assert.equal(row.netScope,'own');
});

test('operator metrics use authorized aggregates while viewers get no invented personal numbers',()=>{
 const [operator,viewer]=dashboardEvents({},[event('operator','2026-10-26','2026-10-28',{summary:{total:5000,sales:2,products:4,initialStock:20,remainingStock:15,artistCount:3,lowStockProducts:2,closedAt:'2026-10-27',settlementNet:4000,paid:1000,pending:3000}}),event('viewer','2026-11-01','2026-11-02',{permissions:{canViewPos:true,role:'viewer',ownerIds:[]}})],today);
 assert.equal(operator.metrics.gross,5000);assert.equal(operator.metrics.artists,3);assert.equal(operator.stock.label,'소진');assert.equal(operator.stock.sold,5);assert.equal(operator.netScope,'event');assert.equal(operator.pending,3000);
 assert.equal(viewer.metrics.gross,null);assert.equal(viewer.metrics.products,null);assert.equal(viewer.metrics.allocated,null);assert.equal(viewer.stock,null);
});

test('unknown schedules stay last and closed events retain their actual calendar status',()=>{
 const model=dashboardEvents({},[event('later','2026-12-01','2026-12-02'),event('unknown',null,null),event('near','2026-11-01','2026-11-02'),event('closed-live','2026-10-26','2026-10-28',{summary:{closedAt:'2026-10-27'}})],today);
 const groups=dashboardFocus(model);
 assert.equal(groups.choices[0].id,'closed-live');assert.equal(groups.choices[0].closed,true);
 assert.deepEqual(groups.upcoming.map(row=>row.id),['near','later']);assert.deepEqual(groups.unknown.map(row=>row.id),['unknown']);
 assert.deepEqual(dashboardFocus(groups.unknown).choices,[]);
 const archived=dashboardEvents({events:[{projectId:'closed',eventName:'closed',closedAt:'2026-10-26',rows:[],sales:[]}]},[],today);
 assert.equal(dashboardFocus(archived).choices[0].id,'closed');
});

test('waiting warning counts only the current actor and event and rejects conflicting bindings',()=>{
 const orders=[
  {projectId:'event',actorId:'me',syncStatus:'PENDING'},
  {projectId:'event',payload:{actorId:'me'},syncStatus:'FAILED'},
  {projectId:'event',actorId:'me',payload:{actorId:'me'},syncStatus:'SYNCING'},
  {projectId:'event',actorId:'other',payload:{actorId:'me'},syncStatus:'PENDING'},
  {projectId:'event',actorId:'me',payload:{actorId:'other'},syncStatus:'PENDING'},
  {projectId:'event',actorId:'me',syncStatus:'SYNCED'},
  {projectId:'different',actorId:'me',syncStatus:'PENDING'},
  {projectId:'event',syncStatus:'PENDING'},
 ];
 assert.equal(countDashboardWaiting(orders,'me','event'),3);
 assert.equal(countDashboardWaiting(orders,'unknown','event'),0);
});


test('attention prioritizes recovery and allocation and excludes unconfirmed negative settlements',()=>{
 const rows=dashboardEvents({inventory:[{allocations:[{projectId:'past',initial:6,sold:1,remaining:5}]}],events:[{projectId:'live',rows:[{net:-29000,pending:0}]},{projectId:'past',closedAt:'2026-10-01',rows:[{net:6000,pending:4000}]}]},[
  event('live','2026-10-26','2026-10-28'),event('past','2026-09-01','2026-09-02'),event('next','2026-11-01','2026-11-02')
 ],today);
 const alerts=dashboardAlerts(rows,14);
 assert.deepEqual(alerts.map(row=>row.type),['recovery','allocation','pending']);
 assert.equal(alerts[1].event.id,'live');
 const closedNegative={...rows[0],closed:true};
 assert.equal(dashboardAlerts([closedNegative],0).some(row=>row.type==='negative'),false);
 assert.equal(dashboardAlerts(rows,0).some(row=>row.type==='allocation'),false);
});

test('attention stays absent for clear, unconfirmed, unknown and unauthorized allocation cases',()=>{
 assert.deepEqual(dashboardAlerts([],14),[]);
 const rows=dashboardEvents({events:[{projectId:'next',rows:[{net:100,pending:100}]}]},[
  event('next','2026-11-01','2026-11-02',{permissions:{canReadOwnHistory:true}}),
  event('unknown',null,null),event('viewer','2026-11-02','2026-11-03',{permissions:{canViewPos:true}})
 ],today);
 assert.deepEqual(dashboardAlerts(rows,14),[]);
 const ended=dashboardEvents({},[event('past','2026-09-01','2026-09-02')],today);
 assert.deepEqual(dashboardAlerts(ended,14).map(row=>row.type),['close']);
 const viewerEnded=dashboardEvents({},[event('past','2026-09-01','2026-09-02',{permissions:{canViewPos:true}})],today);
 assert.deepEqual(dashboardAlerts(viewerEnded,14),[]);
});


test('pinned focus overrides automatic selection for any visible schedule and missing pins fall back',()=>{
 const cards=dashboardEvents({},[event('live','2026-10-26','2026-10-28'),event('future','2026-12-01','2026-12-02'),event('unknown',null,null),event('past','2026-10-01','2026-10-02')],today);
 for(const id of ['future','unknown','past'])assert.deepEqual(dashboardFocus(cards,id).choices.map(row=>row.id),[id]);
 assert.equal(dashboardFocus(cards,'inaccessible').choices[0].id,'live');
 assert.equal(dashboardFocus(cards,'').choices[0].id,'live');
 assert.equal(dashboardFocus([],'removed').choices.length,0);
});

test('attention orders unsynced, recovery, close-needed and allocation',()=>{
 const rows=dashboardEvents({inventory:[{allocations:[{projectId:'past',initial:6,sold:1,remaining:5}]}],waitingOrders:{live:2}},[
  event('live','2026-10-26','2026-10-28'),event('past','2026-09-01','2026-09-02'),event('unclosed','2026-08-01','2026-08-02')
 ],today);
 assert.deepEqual(dashboardAlerts(rows,3).map(row=>row.type),['waiting','recovery','close','close','allocation']);
});

test('past events put follow-ups first, recent first, and classify settlement and stock',()=>{
 const rows=dashboardEvents({inventory:[{allocations:[{projectId:'recover',initial:6,sold:1,remaining:5}]}],events:[
  {projectId:'paid',closedAt:'2026-09-02',rows:[{net:1000,paid:1000,pending:0}],sales:[]},
  {projectId:'unpaid',closedAt:'2026-09-20',rows:[{net:1000,paid:0,pending:1000}],sales:[]}]},[
  event('paid','2026-09-01','2026-09-02'),event('unpaid','2026-09-19','2026-09-20'),event('recover','2026-08-01','2026-08-02'),event('live','2026-10-26','2026-10-28')
 ],today);
 const past=dashboardPastEvents(rows);
 assert.deepEqual(past.rows.map(row=>row.event.id),['unpaid','recover','paid']);
 assert.deepEqual(past.rows.map(row=>row.followUp),[true,true,false]);
 assert.equal(past.followUps,2);
 assert.equal(past.rows[2].settlement,'paid');assert.equal(past.rows[0].settlement,'closed');assert.equal(past.rows[1].settlement,'open');
 assert.equal(past.rows[1].stock,'recover');assert.equal(past.rows[1].remaining,5);
});

test('negative estimates are explained and cost-only estimates are hidden',()=>{
 assert.equal(settlementDisplay({net:-500,closed:true,metrics:{gross:1000}}).kind,'negative');
 assert.equal(settlementDisplay({net:-500,closed:false,metrics:{gross:0}}).kind,'empty');
 assert.equal(settlementDisplay({net:null}).kind,'none');
 assert.equal(settlementDisplay({net:300,closed:false,metrics:{gross:1000}}).provisional,true);
});
