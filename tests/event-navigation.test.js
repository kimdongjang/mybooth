import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {eventDestination,eventActionLabel,readLastEvent,rememberLastEvent} from '../src/utils/eventNavigation.js';

const app = (await readFile(new URL('../src/App.jsx',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const seller = {id:'event',boothId:'booth',permissions:{canSell:true,canViewPos:true}};
const storage = () => {
  const values=new Map();
  return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};

test('event destinations preserve seller, viewer, own-history and closed-event capabilities',()=>{
  assert.equal(eventDestination(null),'projects');
  assert.equal(eventDestination(seller),'pos');
  assert.equal(eventDestination({permissions:{canViewPos:true}}),'pos');
  assert.equal(eventDestination({permissions:{canReadOwnHistory:true}}),'log');
  assert.equal(eventDestination({permissions:{ownerIds:['own']}}),'log');
  assert.equal(eventDestination({permissions:{}}),'projects');
  assert.equal(eventActionLabel({...seller,archivedAt:'closed'}),'행사 내역 열기');
  assert.equal(eventActionLabel({...seller,settlementClosedAt:'closed'}),'행사 내역 열기');
  assert.equal(eventActionLabel({permissions:{canViewPos:true}}),'상품 목록 열기');
  assert.equal(eventActionLabel({permissions:{canReadOwnHistory:true}}),'내 정산 열기');
});

test('last event restores only a matching account, environment, booth and accessible list candidate',()=>{
  const saved=storage();
  saved.setItem('pos_selected_project_id','legacy');
  saved.setItem('pos_dashboard_focus:me','focus');
  assert.equal(readLastEvent(saved,'me','localdb',[seller]),null);
  rememberLastEvent(saved,'me','localdb',seller);
  assert.equal(readLastEvent(saved,'me','localdb',[seller]),seller);
  assert.equal(readLastEvent(saved,'other','localdb',[seller]),null);
  assert.equal(readLastEvent(saved,'me','production',[seller]),null);
  assert.equal(readLastEvent(saved,'me','localdb',[{...seller,boothId:'other'}]),null);
  assert.equal(readLastEvent(saved,'me','localdb',[{...seller,permissions:{}}]),null);
  assert.equal(readLastEvent(saved,'me','localdb',[]),null);
  const closed={...seller,settlementClosedAt:'closed'};
  assert.equal(readLastEvent(saved,'me','localdb',[closed]),closed);
  rememberLastEvent(saved,'me','localdb',null);
  assert.equal(readLastEvent(saved,'me','localdb',[seller]),null);
  assert.doesNotThrow(()=>rememberLastEvent({setItem(){throw Error('unavailable');}},'me','localdb',seller));
});

test('App default entry restores the saved event while explicit pages and login deep links retain their target',()=>{
  const start=app.indexOf('  useEffect(() => {\n    if (!token)');
  const effect=app.slice(start+'  useEffect('.length,app.indexOf('\n  }, [screen',start)+4);
  const run=(overrides={})=>{
    const calls=[];
    const context=vm.createContext({token:'t',loading:false,projectLoading:false,linkedProjectId:null,
      selectedProject:seller,routePage:'pos',routeHash:'',screen:'pos',
      loginReturnPath:{current:null},eventDestination,projectPages:['project'],pageTitles:{pos:'판매'},
      pageForHash:hash=>({'#/sales':'pos','#/dashboard':'dashboard','#/projects':'projects','#/products':'settings'}[hash]||null),
      setScreen:(...args)=>calls.push(args),document:{querySelector:()=>null},...overrides});
    vm.runInContext(`(${effect})()`,context);
    return calls;
  };
  assert.deepEqual(run(),[['pos',true]]);
  assert.deepEqual(run({selectedProject:null,screen:'projects'}),[['projects',true]]);
  assert.deepEqual(run({routePage:'dashboard',routeHash:'#/dashboard',screen:'dashboard'}),[]);
  assert.deepEqual(run({routeHash:'#/sales'}),[]);
  assert.deepEqual(run({routePage:'login',loginReturnPath:{current:'/products?projectId=explicit'}}),[['/products?projectId=explicit',true]]);
  assert.deepEqual(run({routePage:'login',selectedProject:{...seller,permissions:{canReadOwnHistory:true}}}),[['log',true]]);
  assert.deepEqual(run({routePage:'login',selectedProject:{...seller,archivedAt:'closed'}}),[['pos',true]]);
  assert.deepEqual(run({linkedProjectId:'other',routeHash:'#/sales?projectId=other'}),[]);
  assert.deepEqual(run({loading:true}),[]);
});

test('App event switching rejects a cancelled draft or busy state and isolates accepted event projections',async()=>{
  const code=app.slice(app.indexOf('  const selectProject ='),app.indexOf('\n  useEffect(() => {\n    if (!token || loading || saving || projectLoading || !linkedProjectId)'));
  const changes=[],routes=[],remembered=[];
  let allowed=false;
  const before={id:'before',boothId:'booth',permissions:{canSell:true}};
  const context=vm.createContext({saving:false,loading:false,projectLoading:false,selectedProject:before,
    token:'t',activeToken:{current:'t'},activeScope:{current:'t:booth:before'},eventDestination,
    allowNavigation:async()=>allowed,setScreen:async route=>routes.push(route),rememberProject:p=>remembered.push(p),
    ...Object.fromEntries(['ReadyScope','Error','SelectedProject','Products','Bundles','Sales','Cart'].map(key=>[`set${key}`,value=>changes.push([key,value])])),
  });
  vm.runInContext(`${code}\nglobalThis.select=selectProject;`,context);
  assert.equal(await context.select(seller),false);
  assert.equal(changes.length,0);assert.equal(routes.length,0);
  context.saving=true;allowed=true;
  assert.equal(await context.select(seller),false);
  context.saving=false;
  assert.equal(await context.select(seller),true);
  assert.equal(context.activeScope.current,'t:booth:event');
  assert.deepEqual(routes,['pos']);assert.deepEqual(remembered,[seller]);
  assert.equal(changes.find(([key])=>key==='Cart')[1].length,0);
  assert.equal(changes.find(([key])=>key==='SelectedProject')[1],seller);
  const count=changes.length;
  context.activeToken.current='another-account';
  assert.equal(await context.select(seller),false);assert.equal(changes.length,count);
  context.activeToken.current='t';context.selectedProject=seller;
  assert.equal(await context.select(seller),true);assert.equal(changes.length,count);
});
