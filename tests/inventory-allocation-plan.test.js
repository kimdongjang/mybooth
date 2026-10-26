import test from 'node:test';
import assert from 'node:assert/strict';
import {allocationPlan,inventoryEventStatus} from '../src/utils/inventoryAllocationPlan.js';
const today='2026-10-23',item={totalStock:30,minimumTotalStock:30,warehouse:0,allocations:[{projectId:'a',initial:10,sold:7,remaining:3},{projectId:'b',initial:20,sold:0,remaining:20}]},events=[{id:'a',archived_at:'2026',canReturn:true},{id:'b',operator:true}];
test('allocation planning validates total and consumption floors and combined return/reallocation without losing sold stock',()=>{
 const valid=allocationPlan(item,events,'40',{a:'7',b:'30'},today);assert.equal(valid.minimum,37);assert.equal(valid.warehouse,3);assert.equal(valid.changedCount,3);assert.equal(valid.valid,true);
 assert.equal(allocationPlan(item,events,'29',{},today).valid,false);
 assert.match(allocationPlan(item,events,'30',{a:'6'},today).rows[0].error,/7/);
 assert.match(allocationPlan(item,events,'30',{a:'11'},today).rows[0].error,/종료/);
 assert.equal(allocationPlan(item,events,'40',{b:'31'},today).valid,false);
 assert.equal(allocationPlan(item,events,'30',{b:''},today).valid,false);
 const loss=allocationPlan({...item,totalStock:32,minimumTotalStock:32},events,'27',{a:'7',b:'18'},today);assert.equal(loss.minimum,27);
});
test('event status follows active/upcoming/ended dates and closure; missing return permission blocks recovery',()=>{
 assert.equal(inventoryEventStatus({starts_on:'2026-11-01'},today),'upcoming');assert.equal(inventoryEventStatus({ends_on:'2026-10-22'},today),'ended');assert.equal(inventoryEventStatus({closed_at:'2026'},today),'ended');assert.equal(inventoryEventStatus({},today),'active');
 assert.match(allocationPlan(item,[{id:'a',archived_at:'2026',canReturn:false},events[1]],'30',{a:'7'},today).rows[0].error,/권한/);
});
