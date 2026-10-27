import {useEffect,useRef,useState} from 'react';
import {confirmAction} from '../utils/confirmAction';
import {useEventReadRefresh} from '../hooks/useEventReadRefresh';
export default function EventAccessPanel({request,project,onChange,beforeChange}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
 const [linkProfile,setLinkProfile]=useState(null),[query,setQuery]=useState(''),[accounts,setAccounts]=useState([]),[searching,setSearching]=useState(false);
 const [direct,setDirect]=useState(false),[directName,setDirectName]=useState('');
 const readRevision=useEventReadRefresh(request,!busy&&!pending&&!linkProfile);
 const dialog=useRef(null),searchVersion=useRef(0);
 useEffect(()=>{searchVersion.current++;setAccounts([]);setQuery('');setSearching(false);setDirect(false);setDirectName('');if(linkProfile)dialog.current?.showModal();else dialog.current?.close();},[linkProfile]);
 const search=async e=>{e.preventDefault();const version=++searchVersion.current;setSearching(true);setError('');try{const result=await request(`/api/booths?workspace=${linkProfile?.mode==='add'?'searchArtists':'searchAccounts'}&${new URLSearchParams({projectId:project.id,boothId:project.boothId,q:query})}`);if(version===searchVersion.current)setAccounts(result.artists||result.accounts);}catch(e){if(version===searchVersion.current)setError(e.message);}finally{if(version===searchVersion.current)setSearching(false);}};
 const lock=useRef(false);
 const load=async(background=false)=>{const next=await request(`/api/booths?workspace=access&projectId=${encodeURIComponent(project.id)}&boothId=${encodeURIComponent(project.boothId)}`,background?{background:true}:undefined);setData(next);};
 useEffect(()=>{let active=true;request(`/api/booths?workspace=access&projectId=${encodeURIComponent(project.id)}&boothId=${encodeURIComponent(project.boothId)}`).then(d=>{if(active)setData(d);}).catch(e=>{if(active){setError(e.message);if([401,403,404].includes(e.status))setData(null);}});return()=>{active=false;};},[request,project.id,readRevision]);
 const run=async command=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setPending(command);try{await beforeChange?.(command.action);const result=await request('/api/booths',{method:'POST',body:JSON.stringify(command)});if(command.action==='saveEventAccess'&&result.profiles&&result.staff)setData(result);else await load(command.action==='saveEventAccess');await onChange?.(command.action);setPending(null);return result;}catch(e){setError(e.message);if(e.status>=400&&e.status<500){setPending(null);if(e.status===409)await load(command.action==='saveEventAccess').catch(()=>{});}}finally{setBusy(false);lock.current=false;}};
 const send=(action,payload)=>run({action,payload:{boothId:project.boothId,projectId:project.id,...payload,requestId:crypto.randomUUID()}});
 const disabled=busy||Boolean(pending);
 const changeRole=async(profile,role)=>{
  if(disabled||['owner','manager'].includes(profile.booth_role)||!['seller','assistant'].includes(role))return;
  if(!profile.linked_user_id)return send('saveEventAccess',{ownerId:profile.owner_id,role,status:'active',version:profile.version||0});
  const staff=data.staff.find(row=>row.user_id===profile.linked_user_id);
  return send('saveEventAccess',{targetUserId:profile.linked_user_id,role,status:'active',version:staff?.version||0});
 };
 return <div className="event-access-panel">
 {error&&<p role="alert" className="inventory-error">{error}</p>}{pending&&!busy&&<button className="management-back" onClick={()=>run(pending)}>같은 요청 다시 확인</button>}
 <section className="management-product"><div className="management-product-header"><h2>참여 제작자</h2><button type="button" className="management-add" disabled={disabled} onClick={()=>{setError('');setLinkProfile({mode:'add'});}}>제작자 추가</button></div><div className="account-card-body">

  <div className="management-table-wrap event-participant-table-wrap"><table className="management-table event-participant-table"><thead><tr><th scope="col">제작자 닉네임</th><th scope="col">등록 상품</th><th scope="col">계정</th><th scope="col">행사 권한</th><th scope="col">관리</th></tr></thead><tbody>
  {data?.profiles.filter(p=>p.status==='active'&&(p.display_name!=='미지정'||p.linked_user_id)).map(p=>{const staff=data.staff.find(s=>s.user_id===p.linked_user_id);return <tr key={p.owner_id}>
   <td>{p.nickname||p.display_name}{p.nickname&&p.nickname!==p.display_name&&p.display_name!=='미지정'&&<small className="inventory-cell-sub">{p.display_name}</small>}</td><td>{p.product_count||0}개</td>
   <td>{p.linked_user_id?p.nickname||p.linked_user_id:<button type="button" className="management-back event-participant-link" disabled={disabled||p.status!=='active'||p.booth_status==='ended'} onClick={()=>{setError('');setLinkProfile(p);}}>+연결</button>}</td>
   <td><label><span className="sr-only">{p.nickname||p.display_name} 행사 권한</span><select aria-label={`${p.nickname||p.display_name} 행사 권한`} disabled={disabled||['owner','manager'].includes(p.booth_role)} value={['owner','manager'].includes(p.booth_role)?'operator':staff?.status==='active'?staff.role:p.booth_role==='seller'?'seller':!p.linked_user_id&&p.requested_role?p.requested_role:'none'} onChange={e=>changeRole(p,e.target.value)}>{['owner','manager'].includes(p.booth_role)&&<option value="operator">운영자</option>}<option value="none" disabled>권한 선택</option><option value="seller">부스참여자</option><option value="assistant">부관리자</option></select></label></td>
   <td><button type="button" className="management-delete" disabled={disabled} onClick={async()=>{if(await confirmAction('이 제작자를 행사에서 삭제할까요? 재고와 이전 판매·정산은 유지하고 상품의 제작자 연결을 해제합니다.',{title:'참여 제작자 삭제',confirmLabel:'삭제'}))await send('removeEventArtist',{ownerId:p.owner_id,version:p.version||0});}}>삭제</button></td>
  </tr>;})}
  </tbody></table></div>
 </div></section>
 <dialog ref={dialog} className="app-confirm-dialog event-account-dialog" aria-labelledby="event-account-dialog-title" onCancel={e=>{if(disabled)e.preventDefault();else setLinkProfile(null);}}>
  <div className="management-heading"><h2 id="event-account-dialog-title">{linkProfile?.mode==='add'?'제작자 추가':`${linkProfile?.display_name||''} 계정 연결`}</h2><button type="button" className="management-back" disabled={disabled} onClick={()=>setLinkProfile(null)}>닫기</button></div>
  {direct&&linkProfile?.mode==='add'&&<button type="button" className="management-back" disabled={disabled||searching} onClick={()=>setDirect(false)}>검색으로 돌아가기</button>}
  {direct&&linkProfile?.mode==='add'?<form className="account-form" onSubmit={async e=>{e.preventDefault();const result=await send('createEventCreator',{name:directName.trim()});if(result?.added)setLinkProfile(null);}}><label>제작자 이름<input autoFocus required maxLength={80} value={directName} disabled={disabled} onChange={e=>setDirectName(e.target.value)}/></label><button className="management-add" disabled={disabled||!directName.trim()}>제작자 등록</button></form>:<>
  <form className="event-account-search" onSubmit={search}><label><span className="sr-only">{linkProfile?.mode==='add'?'제작자 이름·닉네임·아이디·이메일 검색':'계정 닉네임·아이디·이메일 검색'}</span><input autoFocus required minLength={2} maxLength={100} value={query} onChange={e=>setQuery(e.target.value)} placeholder={linkProfile?.mode==='add'?'제작자 이름·닉네임·아이디·이메일':'닉네임·아이디·이메일'} disabled={disabled||searching}/></label><button className="management-add" disabled={disabled||searching}>{searching?'검색 중…':'검색'}</button></form>

  {linkProfile?.mode==='add'&&<button type="button" className="management-back" disabled={disabled||searching} onClick={()=>{setDirectName(query.trim());setDirect(true);}}>새 제작자 등록</button>}
  </>}
  {error&&<p role="alert" className="inventory-error">{error}</p>}
  {pending&&!busy&&<button type="button" className="management-back" onClick={async()=>{const result=await run(pending);if(result?.linked||result?.added)setLinkProfile(null);}}>같은 요청 다시 확인</button>}
  {!direct&&<ul className="event-account-results">{accounts.map(account=><li key={account.id}><div><strong>{account.nickname||account.display_name||account.id}</strong><small>{account.display_name||account.id}</small></div><button type="button" className="management-add" disabled={disabled||Boolean(account.registered)} onClick={async()=>{const result=linkProfile.mode==='add'?await send('addEventArtist',{profileId:account.id,role:'none'}):await send('linkEventArtistAccount',{profileId:linkProfile.id,targetUserId:account.id});if(result?.linked||result?.added)setLinkProfile(null);}}>{account.registered?'등록됨':linkProfile?.mode==='add'?'등록':'연결'}</button></li>)}</ul>}
 </dialog>
 </div>;
}
