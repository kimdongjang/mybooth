import test from 'node:test';
import assert from 'node:assert/strict';
import {eventSettlementPreview,validateEventCosts} from '../src/utils/eventSettlement.js';
const cost=(value,split='equal',type='fixed')=>({label:'비용',memo:'',value,split,type});
test('rounding distributes every won deterministically, including zero sales and percentage fees',()=>{
 const products=['가','나','다'].map((creatorName,i)=>({id:String(i),creatorName}));
 const empty=eventSettlementPreview({products,sales:[]},[cost(10)]);
 assert.deepEqual(empty.rows.map(r=>r.fees),[4,3,3]);assert.equal(empty.net,-10);
 const ratio=eventSettlementPreview({products,sales:[]},[cost(2,'ratio')]);assert.equal(ratio.fees,2);
 const sold=eventSettlementPreview({products,sales:[{lines:products.map((p,i)=>({type:'product',id:p.id,creatorName:p.creatorName,qty:1,unitPrice:i+1}))}]},[cost(1,'ratio'),cost(2500,'ratio','percent')]);
 assert.equal(sold.gross,6);assert.equal(sold.fees,3);assert.equal(sold.rows.reduce((sum,r)=>sum+r.net,0),3);
});
test('cost validation rejects fractional money, invalid percentages, negative values and unsupported splits',()=>{
 for(const item of [cost(-1),cost(1.5),cost(10001,'ratio','percent'),cost(1,'individual'),{...cost(1),memo:null},{...cost(1),label:''}])assert.throws(()=>validateEventCosts([item]));
 assert.throws(()=>eventSettlementPreview({sales:[]},[cost(1)]),/작가/);
});
