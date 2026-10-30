import {useEffect,useRef,useState} from 'react';
import ArtistAccount from '../components/ArtistAccount';
import ContractRetirement from '../components/ContractRetirement';
import AccountBackup from '../components/AccountBackup';
export default function BoothWorkspace({request,beforeClose,onChange}) {
 const [open,setOpen]=useState(false);
 const [booths,setBooths]=useState([]),[boothId,setBooth]=useState(''),[data,setData]=useState(null),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
 const lock=useRef(false);
 useEffect(()=>{let active=true;request('/api/booths?artists=home').then(home=>{if(active){const own=home.booths.filter(b=>['owner','manager'].includes(b.role));setBooths(own);setBooth(own[0]?.id||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request]);
 const load=async()=>{const next=await request(`/api/booths?workspace=booth&boothId=${encodeURIComponent(boothId)}`);setData(next);setName(next.name);};
 useEffect(()=>{setData(null);if(!open||!boothId)return;let active=true;request(`/api/booths?workspace=booth&boothId=${encodeURIComponent(boothId)}`).then(next=>{if(active){setData(next);setName(next.name);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[open,boothId,request]);
 const run=async command=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setPending(command);try{await request('/api/booths',{method:'POST',body:JSON.stringify(command)});setPending(null);await load();}catch(e){setError(e.message);if(e.status>=400&&e.status<500)setPending(null);}finally{setBusy(false);lock.current=false;}};
 const save=payload=>run({action:'saveBoothManagement',payload:{boothId,...payload,requestId:crypto.randomUUID()}});
 const disabled=busy;
 return <section className="page-body"><button type="button" className="management-back" onClick={()=>{setOpen(!open);if(open)onChange();}}>부스 관리</button>{open&&<>
  {error&&<p role="alert" className="inventory-error">{error}</p>}
  <label>관리 부스<select value={boothId} disabled={disabled} onChange={e=>setBooth(e.target.value)}>{booths.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  {data&&<section className="management-product"><div className="account-card-body">
   <form className="account-form" onSubmit={e=>{e.preventDefault();save({name,expectedName:data.name});}}><label>부스명<input required maxLength={80} value={name} disabled={disabled} onChange={e=>setName(e.target.value)}/></label><button className="management-add" disabled={disabled}>부스명 저장</button></form>
   {data.role==='owner'&&<div><h3>부스 공통 멤버</h3>{data.profiles.filter(p=>p.linked_user_id).map(p=>{const member=data.members.find(m=>m.user_id===p.linked_user_id);if(member?.role==='owner')return null;return <label key={p.id}>{p.display_name}<select disabled={disabled} value={member?.status==='active'?member.role:'none'} onChange={e=>save({targetUserId:p.linked_user_id,role:e.target.value==='none'?'viewer':e.target.value,status:e.target.value==='none'?'ended':'active',expectedRole:member?.role||null,expectedStatus:member?.status||null})}><option value="none">제작자 참여만</option><option value="viewer">부스 조회</option><option value="seller">부스 전체 판매 담당</option><option value="manager">부스 전체 운영자</option></select></label>;})}</div>}
  </div></section>}
  <ArtistAccount request={request} mode="booth"/>
  <ContractRetirement request={request} beforeClose={beforeClose}/>
  <AccountBackup request={request} restoreAllowed={false} beforeBackup={beforeClose} afterRestore={()=>{}}/>
 </>}</section>;
}
