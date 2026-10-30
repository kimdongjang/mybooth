import {useEffect,useRef,useState} from 'react';

export default function CreatorField({creators=[],value={},onChange,request,project,allowDirect=false,disabled=false,onRefresh,onBusyChange}){
 const [direct,setDirect]=useState(Boolean(value.artistName&&!value.ownerId)),[extra,setExtra]=useState([]),[mode,setMode]=useState(''),[query,setQuery]=useState(''),[results,setResults]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef(null),lock=useRef(false),pending=useRef(null),generation=useRef(0);
 const options=[...creators,...extra].filter((row,index,all)=>!row.stockOnly&&(row.label!=='미지정'||row.linked)&&all.findIndex(r=>r.ownerId===row.ownerId)===index);
 const selected=options.find(row=>row.ownerId===value.ownerId);
 useEffect(()=>{generation.current++;setQuery('');setResults([]);setError('');if(mode)dialog.current?.showModal();else dialog.current?.close();},[mode]);
 const send=async(action,payload)=>{
  if(pending.current&&pending.current.action!==action)pending.current=null;pending.current||={action,payload:{boothId:project.boothId,projectId:project.id,...payload,requestId:crypto.randomUUID()}};
  const result=await request('/api/booths',{method:'POST',body:JSON.stringify(pending.current)});pending.current=null;return result;
 };
 const run=async work=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(e){if(e.status>=400&&e.status<500)pending.current=null;setError(e.message);}finally{lock.current=false;setBusy(false);}};
 const choose=async row=>{
  if(!row.registered&&request)await send('addEventArtist',{profileId:row.profileId,role:'none'});
  setExtra(current=>[...current,row]);setDirect(false);onChange({ownerId:row.ownerId,artistName:'',label:row.label});await onRefresh?.();setMode('');
 };
 const ensureDirect=async()=>{
  if(selected)return selected;
  if(!value.artistName?.trim())throw new Error('제작자 이름을 입력해주세요.');
  const result=await send('createEventCreator',{name:value.artistName.trim()});
  const row={ownerId:result.ownerId,profileId:result.profileId,label:value.artistName.trim(),linked:false,registered:true};
  setExtra(current=>[...current,row]);setDirect(false);onChange({ownerId:row.ownerId,artistName:'',label:row.label});await onRefresh?.();return row;
 };
 const search=()=>run(async()=>{
  if(query.trim().length<2)throw new Error('검색어를 2자 이상 입력해주세요.');
  const version=++generation.current;
  if(!request){setResults(options.filter(row=>row.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(row=>({...row,registered:true})));return;}
  const response=await request(`/api/booths?workspace=${mode==='accounts'?'searchAccounts':'searchArtists'}&${new URLSearchParams({projectId:project.id,boothId:project.boothId,q:query.trim()})}`);
  if(version===generation.current)setResults(mode==='accounts'?response.accounts:response.artists.map(row=>({ownerId:row.owner_id,profileId:row.id,label:row.nickname||row.display_name,linked:Boolean(row.linked_user_id),registered:row.registered})));
 });
 const blocked=disabled||busy;
 useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
 useEffect(()=>()=>onBusyChange?.(false),[onBusyChange]);
 const retry=()=>run(async()=>{
   const command=pending.current,result=await send();
   if(['createEventCreator','addEventArtist'].includes(command.action)){
    const label=command.payload.name||results.find(r=>r.profileId===command.payload.profileId)?.label||'';
    const row={ownerId:result.ownerId,profileId:result.profileId,label,linked:false,registered:true};
    setExtra(current=>[...current,row]);setDirect(false);onChange({ownerId:row.ownerId,artistName:'',label});
   }
   if(command.action==='linkEventArtistAccount')setExtra(current=>[...current.filter(r=>r.ownerId!==selected.ownerId),{...selected,linked:true}]);
   await onRefresh?.();setMode('');
  });
 return <fieldset className="creator-field" disabled={disabled}><legend>제작자</legend>
  <div className="creator-field-controls"><label className="management-field"><span className="sr-only">행사 제작자</span><select aria-label="행사 제작자" required={!direct&&!allowDirect} value={direct?'':value.ownerId||''} disabled={blocked} onChange={e=>{setDirect(false);onChange({ownerId:e.target.value,artistName:'',label:options.find(row=>row.ownerId===e.target.value)?.label||''});}}><option value="">{allowDirect?'미지정':'제작자 선택'}</option>{options.map(row=><option key={row.ownerId} value={row.ownerId}>{row.label}{row.linked?' · 연동완료':''}</option>)}</select></label><button type="button" className="management-back" disabled={blocked} onClick={()=>setMode('creators')}>제작자 검색</button>{allowDirect&&<button type="button" className="management-back" disabled={blocked} onClick={()=>{setDirect(true);onChange({ownerId:'',artistName:''});}}>직접 입력</button>}</div>
  {direct&&<label className="management-field"><span>제작자 이름</span><input required maxLength={80} value={value.artistName||''} disabled={blocked} onChange={e=>onChange({ownerId:'',artistName:e.target.value})}/></label>}
  {direct&&request&&<button type="button" className="management-back" disabled={blocked||!value.artistName?.trim()} onClick={()=>run(ensureDirect)}>제작자 추가</button>}
  {selected?.linked&&<span className="revenue-status">연동완료</span>}
  {allowDirect&&request&&((selected&&!selected.linked&&selected.profileId)||direct)&&<button type="button" className="management-back" disabled={blocked||direct&&!value.artistName?.trim()} onClick={()=>run(async()=>{await ensureDirect();setMode('accounts');})}>계정 연결</button>}
  {error&&!mode&&<p role="alert" className="inventory-error">{error}</p>}
  <dialog ref={dialog} className="app-confirm-dialog event-account-dialog" aria-label={mode==='accounts'?'제작자 계정 연결':'제작자 검색'} onCancel={e=>{if(busy)e.preventDefault();else setMode('');}}>
   <div className="management-heading"><h2>{mode==='accounts'?'제작자 계정 연결':'제작자 검색'}</h2><button type="button" className="management-back" disabled={busy} onClick={()=>setMode('')}>닫기</button></div>
   <div className="event-account-search"><input aria-label="제작자 검색어" autoFocus value={query} maxLength={100} placeholder="이름·닉네임·아이디·이메일" disabled={blocked} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();search();}}}/><button type="button" className="management-add" disabled={blocked} onClick={search}>검색</button></div>
   {error&&<p role="alert" className="inventory-error">{error}</p>}
   <ul className="event-account-results">{results.map(row=><li key={row.ownerId||row.id}><div><strong>{row.label||row.nickname||row.id}</strong>{row.linked&&<span className="revenue-status">연동완료</span>}</div><button type="button" className="management-add" disabled={blocked} onClick={()=>run(async()=>{if(mode==='accounts'){await send('linkEventArtistAccount',{profileId:selected.profileId,targetUserId:row.id});setExtra(current=>[...current.filter(r=>r.ownerId!==selected.ownerId),{...selected,linked:true}]);await onRefresh?.();setMode('');}else await choose(row);})}>{mode==='accounts'?'연결':row.registered?'선택':'행사에 추가'}</button></li>)}</ul>
  </dialog>
 </fieldset>;
}
