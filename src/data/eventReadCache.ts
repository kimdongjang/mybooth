import {localData, type DataScope} from './localFirst';

const prefix='event-read:';
const failure=()=>Object.assign(new Error('로그인 또는 행사 범위가 변경되었습니다.'),{status:409});

// Only explicit read contracts use this cache. Commands always reach the server.
export function createEventReadCache({scope,request,isCurrent,store=localData}:{scope:DataScope;request:(url:string,options?:any)=>Promise<any>;isCurrent:()=>boolean;store?:typeof localData}) {
 const reads=new Map<string,string>(),flights=new Map<string,Promise<any>>(),listeners=new Set<()=>void>();
 let generation=0;
 const canonical=(url:string)=>{const parsed=new URL(url,'https://local.invalid');parsed.searchParams.sort();return parsed.pathname+parsed.search;};
 const eligible=(url:string)=>{
  const parsed=new URL(url,'https://local.invalid'),query=parsed.searchParams;
  if(parsed.origin!=='https://local.invalid'||query.has('projectId')&&query.get('projectId')!==scope.projectId||query.has('boothId')&&query.get('boothId')!==scope.boothId)return false;
  return parsed.pathname==='/api/settlements'&&query.get('projectId')===scope.projectId||parsed.pathname==='/api/booths'&&(
   ['home','stockParticipants','access'].includes(query.get('workspace')||'')||['stock','history','movements'].includes(query.get('artists')||''));
 };
 const read=(url:string,options:any={},force=false):Promise<any>=>{
  const key=canonical(url),resource=prefix+key,version=generation,flightKey=`${version}:${key}`;
  reads.set(key,url);
  if(flights.has(flightKey))return flights.get(flightKey)!;
  const pending=(async()=>{
   if(!isCurrent())throw failure();
   // App already maintains the authenticated workspace cache on its own timer.
   if(key==='/api/booths?workspace=home'){
    const workspace=await store.get({actorId:scope.actorId},'workspace');
    if(!isCurrent()||version!==generation)throw failure();
    if(workspace)return workspace;
   }
   const result=await store.read({scope,resource,preferCache:!force,isCurrent,fetchRemote:()=>request(url,{...options,background:true,signal:AbortSignal.timeout(20_000)})});
   const value=force?await result.refresh:result.value;
   if(!isCurrent()||version!==generation)throw failure();
   return value;
  })().finally(()=>flights.delete(flightKey));
  flights.set(flightKey,pending);return pending;
 };
 const invalidate=async()=>{generation++;await store.invalidate(scope,prefix);};
 const cachedRequest=async(url:string,options:any={})=>{
  if(!isCurrent())throw failure();
  const method=String(options.method||'GET').toUpperCase();
  if(method==='GET'&&eligible(url))return read(url,options);
  let result;
  try{result=await request(url,options);}catch(error:any){
   if(method!=='GET'&&[401,403,404,409].includes(error.status))await invalidate();
   throw error;
  }
  if(!isCurrent())throw failure();
  if(method!=='GET')await invalidate();
  return result;
 };
 cachedRequest.subscribe=(listener:()=>void)=>{
  if(!listeners.size)reads.clear();
  listeners.add(listener);
  return()=>{listeners.delete(listener);if(!listeners.size)reads.clear();};
 };
 const refresh=async({activeOnly=false}={})=>{
  if(!isCurrent())return false;
  if(activeOnly&&!listeners.size)return true;
  const version=generation,urls=[...reads.values()];
  const results=await Promise.allSettled(urls.map(url=>read(url,{},true)));
  if(!isCurrent()||version!==generation)return false;
  for(const listener of listeners)listener();
  return results.every(result=>result.status==='fulfilled');
 };
 return {request:cachedRequest,refresh,invalidate};
}
