import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiContractContext} from '../src/utils/apiContractContext.js';

test('new requests carry the authenticated booth while account operations and stored orders remain unchanged',()=>{
  const context=createApiContractContext();
  context.prepare('token-a','/api/pos');context.observe('token-a','/api/pos',{boothId:'booth-a'});
  const original={method:'POST',body:JSON.stringify({action:'createProject',payload:{name:'행사'}})};
  const prepared=context.prepare('token-a','/api/pos',original);
  assert.equal(JSON.parse(prepared.body).boothId,'booth-a');assert.equal(JSON.parse(original.body).boothId,undefined);
  const account={method:'POST',body:JSON.stringify({action:'updateProfile',payload:{nickname:'작가'}})};
  assert.equal(context.prepare('token-a','/api/pos',account),account);
  const explicit={method:'POST',body:JSON.stringify({boothId:'booth-b',action:'addPayment'})};
  assert.equal(JSON.parse(context.prepare('token-a','/api/settlements',explicit).body).boothId,'booth-b');
  const artist={method:'POST',body:JSON.stringify({action:'adjustArtistStock',payload:{ownerId:'personal'}})};
  assert.equal(context.prepare('token-a','/api/booths',artist),artist);
});

test('account switching and late prior-account responses never attach a previous booth',()=>{
  const context=createApiContractContext();context.prepare('token-a','/api/pos');context.observe('token-a','/api/pos',{boothId:'a'});
  context.prepare('token-b','/api/pos');context.observe('token-a','/api/pos',{boothId:'leak'});
  const body={method:'POST',body:JSON.stringify({action:'createProject'})};
  assert.equal(context.prepare('token-b','/api/pos',body),body);
  context.observe('token-b','/api/pos',{boothId:'b'});assert.equal(JSON.parse(context.prepare('token-b','/api/pos',body).body).boothId,'b');
  assert.equal(context.prepare(null,'/api/pos',body),body);
});
