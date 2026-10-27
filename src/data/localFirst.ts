import {db} from '../database/dexie';

export interface DataScope { actorId:string; boothId?:string; projectId?:string; ownerId?:string; }
type Command = {sequence?:number;id:string;actorId:string;scopeKey:string;resourceKey:string;resource:string;scope:DataScope;operation:string;payload:unknown;status:string;error?:string};
type Operation = {
 offline:'queue'|'online-only';
 // Queue adapters must use the same command ID for server idempotency.
 execute:(scope:DataScope,payload:any,commandId:string)=>Promise<unknown>;
 reduce?:(current:any,payload:any)=>any;
};
const failure=(message:string,status?:number)=>Object.assign(new Error(message),{status});
export const scopeKey=(scope:DataScope)=>{
 if(!scope.actorId)throw failure('로그인 계정이 필요합니다.',401);
 return JSON.stringify([scope.actorId,scope.boothId||'',scope.projectId||'',scope.ownerId||'']);
};
const keyFor=(scope:DataScope,resource:string)=>JSON.stringify([scopeKey(scope),resource]);

export class LocalFirstStore {
 private operations=new Map<string,Operation>();
 private listeners=new Set<(key:string)=>void>();
 private running=false;
 constructor(private database=db,private online=()=>typeof navigator==='undefined'||navigator.onLine){}
 private get resources(){return this.database.table('resources');}
 private get commands(){return this.database.table<Command,number>('resourceCommands');}
 register(name:string,operation:Operation){
  if(operation.offline==='queue'&&!operation.reduce)throw failure('오프라인 작업에는 로컬 반영 규칙이 필요합니다.');
  if(this.operations.has(name))throw failure('이미 등록된 데이터 작업입니다.');
  this.operations.set(name,operation);
 }
 subscribe(listener:(key:string)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private emit(key:string){for(const listener of this.listeners)listener(key);}
 async get<T>(scope:DataScope,resource:string):Promise<T|undefined>{const row=await this.resources.get(keyFor(scope,resource));return row?.revoked?undefined:row?.value;}
 async invalidate(scope:DataScope,prefix:string){
  await this.resources.where('scopeKey').equals(scopeKey(scope)).modify(row=>{
   if(JSON.parse(row.key)[1].startsWith(prefix)){row.stale=true;row.revision=crypto.randomUUID();}
  });
 }
 async put(scope:DataScope,resource:string,value:unknown){
  const key=keyFor(scope,resource);
  await this.database.transaction('rw',this.resources,this.commands,async()=>{
   if(await this.commands.where('resourceKey').equals(key).count())throw failure('미동기화 변경을 먼저 확인해주세요.',409);
   await this.resources.put({key,scopeKey:scopeKey(scope),actorId:scope.actorId,value,updatedAt:Date.now(),revision:crypto.randomUUID()});
  });this.emit(key);
 }
 async read<T>({scope,resource,fetchRemote,isCurrent=()=>true,onUpdate,onError,preferCache=false}:{scope:DataScope;resource:string;fetchRemote:()=>Promise<T>;isCurrent?:()=>boolean;onUpdate?:(value:T|undefined)=>void;onError?:(error:any)=>void;preferCache?:boolean}){
  const key=keyFor(scope,resource),cached=await this.resources.get(key);
  if(!isCurrent())throw failure('로그인 또는 데이터 범위가 변경되었습니다.',409);
  if(preferCache&&cached&&!cached.revoked&&(!cached.stale||!this.online()))return {value:cached.value as T,source:'local' as const,refresh:Promise.resolve(cached.value as T)};
  const refresh=async()=>{
   if(!this.online())throw failure('인터넷 연결이 필요합니다.');
   try{
    const value=await fetchRemote();
    if(!isCurrent())throw failure('로그인 또는 데이터 범위가 변경되었습니다.',409);
    let accepted=false;
    await this.database.transaction('rw',this.resources,this.commands,async()=>{
     const latest=await this.resources.get(key);
     // A remote read started before a local command cannot erase its effects,
     // even when that command has already been uploaded in the meantime.
     if(latest?.revision!==cached?.revision||await this.commands.where('resourceKey').equals(key).count())return;
     if(!isCurrent())return;
     await this.resources.put({key,scopeKey:scopeKey(scope),actorId:scope.actorId,value,updatedAt:Date.now(),revision:crypto.randomUUID()});accepted=true;
    });
    const result=accepted?value:await this.get<T>(scope,resource);
    if(isCurrent()){onUpdate?.(result);this.emit(key);}return result;
   }catch(error:any){
    if(isCurrent()&&[401,403,404].includes(error.status)){
     // Hide revoked data without destroying the local projection needed to
     // recover unsent changes after the same account is authorized again.
     await this.resources.update(key,{revoked:true});onUpdate?.(undefined);this.emit(key);
    }
    if(isCurrent())onError?.(error);throw error;
   }
  };
  const refreshed=this.online()?refresh():Promise.reject(failure('인터넷 연결이 필요합니다.'));
  // Cached callers may choose to await refresh; always handle the background
  // rejection as well so an offline screen does not create unhandled promises.
  void refreshed.catch(()=>{});
  if(cached&&!cached.revoked&&!(preferCache&&cached.stale))return {value:cached.value as T,source:'local' as const,refresh:refreshed};
  return {value:await refreshed as T,source:'remote' as const,refresh:refreshed};
 }
 async mutate({scope,resource,operation,payload,isCurrent=()=>true}:{scope:DataScope;resource:string;operation:string;payload:any;isCurrent?:()=>boolean}){
  const adapter=this.operations.get(operation);if(!adapter)throw failure('등록되지 않은 데이터 작업입니다.');
  const id=crypto.randomUUID(),key=keyFor(scope,resource);
  if(!isCurrent())throw failure('로그인 또는 데이터 범위가 변경되었습니다.',409);
  if(adapter.offline==='online-only'){
   if(!this.online())throw failure('이 작업은 인터넷 연결이 필요합니다.');
   const result=await adapter.execute(scope,payload,id);
   if(!isCurrent())throw failure('로그인 또는 데이터 범위가 변경되었습니다.',409);
   // Explicit caller revalidation avoids inventing a projection from an API receipt.
   return {id,queued:false,result};
  }
  await this.database.transaction('rw',this.resources,this.commands,async()=>{
   const current=await this.resources.get(key);if(!current||current.revoked)throw failure('온라인에서 데이터를 먼저 준비해주세요.');
   if(!isCurrent())throw failure('로그인 또는 데이터 범위가 변경되었습니다.',409);
   const value=adapter.reduce!(current.value,payload);
   await this.commands.add({id,actorId:scope.actorId,scopeKey:scopeKey(scope),resourceKey:key,resource,scope:{...scope},operation,payload,status:'PENDING'});
   await this.resources.put({...current,value,updatedAt:Date.now(),revision:crypto.randomUUID()});
  });this.emit(key);return {id,queued:true};
 }
 async pending(actorId:string){return this.commands.where('actorId').equals(actorId).sortBy('sequence');}
 async sync(actorId:string,isCurrent=()=>true){
  if(!this.online()||this.running||!isCurrent())return;
  if(typeof navigator==='undefined'||!navigator.locks)throw failure('안전한 동기화에 Web Locks가 필요합니다.');
  return navigator.locks.request('pos-resource-upload',{ifAvailable:true},async lock=>{
   if(!lock||this.running)return;this.running=true;
   try{
    for(const command of await this.pending(actorId)){
     if(!isCurrent()||!this.online())break;
     // Preserve dependencies: a conflict/auth error blocks following commands.
     if(command.status==='CONFLICT'||command.status==='BLOCKED')break;
     const adapter=this.operations.get(command.operation);if(!adapter)break;
     await this.commands.update(command.sequence!,{status:'SYNCING'});
     if(!isCurrent())break;
     try{
      await adapter.execute(command.scope,command.payload,command.id);
      await this.commands.delete(command.sequence!);this.emit(command.resourceKey);
     }catch(error:any){
      await this.commands.update(command.sequence!,{status:error.status===409?'CONFLICT':[400,401,403,404,410,422].includes(error.status)?'BLOCKED':'FAILED',error:error.message});break;
     }
    }
   }finally{this.running=false;}
  });
 }
 start(actorId:string,isCurrent=()=>true,intervalMs=10_000){
  const run=()=>{void this.sync(actorId,isCurrent).catch(()=>{});};
  const timer=setInterval(run,intervalMs);globalThis.addEventListener?.('online',run);run();
  return()=>{clearInterval(timer);globalThis.removeEventListener?.('online',run);};
 }
}

export const localData=new LocalFirstStore();
