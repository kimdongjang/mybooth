import {useEffect,useRef,useState} from 'react';
export default function EventAccessPanel({request,project}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null),[name,setName]=useState(''),[code,setCode]=useState('');
 const [startsOn,setStart]=useState(''),[endsOn,setEnd]=useState('');
 const lock=useRef(false);
 const load=async()=>{const next=await request(`/api/booths?workspace=access&projectId=${encodeURIComponent(project.id)}&boothId=${encodeURIComponent(project.boothId)}`);setData(next);};
 useEffect(()=>{let active=true;request(`/api/booths?workspace=access&projectId=${encodeURIComponent(project.id)}&boothId=${encodeURIComponent(project.boothId)}`).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request,project.id]);
 const run=async command=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setPending(command);try{const result=await request('/api/booths',{method:'POST',body:JSON.stringify(command)});setPending(null);if(result.invitation)setCode(result.invitation.token);await load();}catch(e){setError(e.message);if(e.status>=400&&e.status<500)setPending(null);}finally{setBusy(false);lock.current=false;}};
 const send=(action,payload)=>run({action,payload:{boothId:project.boothId,projectId:project.id,...payload,requestId:crypto.randomUUID()}});
 const disabled=busy||Boolean(pending);
 return <section className="management-product"><div className="management-product-header"><h2>참여 작가·판매 권한</h2></div><div className="account-card-body">
 {error&&<p role="alert" className="inventory-error">{error}</p>}{pending&&!busy&&<button onClick={()=>run(pending)}>같은 요청 다시 확인</button>}
 <form className="account-form" onSubmit={e=>{e.preventDefault();send('createBoothArtist',{name});}}><label>계정 없는 작가명<input required value={name} onChange={e=>setName(e.target.value)} disabled={disabled}/></label><button className="management-add" disabled={disabled}>미연동 작가 추가</button></form>
 {data?.profiles.map(p=>{const staff=data.staff.find(s=>s.user_id===p.linked_user_id);return <div key={p.owner_id} className="management-fields"><strong>{p.display_name}</strong>
  <button disabled={disabled||p.booth_status==='ended'} onClick={()=>send('saveEventAccess',{ownerId:p.owner_id,status:p.status==='active'?'ended':'active',version:p.version||0})}>{p.status==='active'?'행사 참여 종료':'행사에 추가'}</button>
  {!p.linked_user_id&&p.display_name!=='미지정'&&<button disabled={disabled} onClick={()=>send('issueArtistInvitation',{profileId:p.id})}>계정 연결 초대</button>}
  {p.linked_user_id&&p.status==='active'&&<label>행사 역할<select disabled={disabled} value={staff?.status==='active'?staff.role:'artist'} onChange={e=>send('saveEventAccess',{targetUserId:p.linked_user_id,role:e.target.value==='artist'?'seller':e.target.value,status:e.target.value==='artist'?'ended':'active',version:staff?.version||0})}><option value="artist">참여 작가</option><option value="seller">판매 담당</option><option value="assistant">부관리자 · 판매/설정</option></select></label>}
 </div>;})}
 {code&&<label>계정 연결 초대 코드<input value={code} readOnly/></label>}
 <form className="account-form" onSubmit={e=>{e.preventDefault();send('saveEventStockSchedule',{startsOn,endsOn});}}><label>행사 시작일<input type="date" required value={startsOn} disabled={disabled} onChange={e=>setStart(e.target.value)}/></label><label>행사 종료일<input type="date" required min={startsOn} value={endsOn} disabled={disabled} onChange={e=>setEnd(e.target.value)}/></label><button className="management-add" disabled={disabled}>일정 저장</button></form>
 <a className="management-back" href={`#/settlement?projectId=${encodeURIComponent(project.id)}`}>비용·지급·정산 마감</a>
 </div></section>;
}
