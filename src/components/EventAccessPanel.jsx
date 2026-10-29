import {useEffect,useRef,useState} from 'react';
import {confirmAction} from '../utils/confirmAction';
import {useEventReadRefresh} from '../hooks/useEventReadRefresh';
export default function EventAccessPanel({request,project,onChange,beforeChange}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
 const [linkProfile,setLinkProfile]=useState(null),[query,setQuery]=useState(''),[accounts,setAccounts]=useState([]),[searching,setSearching]=useState(false);
 const [direct,setDirect]=useState(false),[directName,setDirectName]=useState('');
 const [accountOwnerId,setAccountOwnerId]=useState(null);
 const accountDialog=useRef(null);
 const readRevision=useEventReadRefresh(request,!busy&&!pending&&!linkProfile);
 const dialog=useRef(null),searchVersion=useRef(0);
 useEffect(()=>{searchVersion.current++;setAccounts([]);setQuery('');setSearching(false);setDirect(false);setDirectName('');if(linkProfile)dialog.current?.showModal();else dialog.current?.close();},[linkProfile]);
 const search=async e=>{e.preventDefault();const version=++searchVersion.current;setSearching(true);setError('');try{const result=await request(`/api/booths?workspace=${linkProfile?.mode==='add'?'searchArtists':'searchAccounts'}&${new URLSearchParams({projectId:project.id,boothId:project.boothId,q:query})}`);if(version===searchVersion.current)setAccounts(result.artists||result.accounts);}catch(e){if(version===searchVersion.current)setError(e.message);}finally{if(version===searchVersion.current)setSearching(false);}};
 const [inviteLink,setInviteLink]=useState('');
 const inviteDialog=useRef(null),inviteInput=useRef(null);
 useEffect(()=>{if(inviteLink){if(!inviteDialog.current?.open)inviteDialog.current?.showModal();inviteInput.current?.select();}else if(inviteDialog.current?.open)inviteDialog.current.close();},[inviteLink]);
 const [copied,setCopied]=useState(false),copiedTimer=useRef(0);
 const showCopied=()=>{setCopied(true);clearTimeout(copiedTimer.current);copiedTimer.current=setTimeout(()=>setCopied(false),2000);};
 useEffect(()=>()=>clearTimeout(copiedTimer.current),[]);
 const copyLink=async()=>{inviteInput.current?.select();try{await navigator.clipboard.writeText(inviteLink);showCopied();}catch{if(document.execCommand?.('copy'))showCopied();}};
 const copyInvite=async()=>{
  if(busy)return;setBusy(true);setError('');setInviteLink('');
  try{
   const {invite}=await request('/api/booths',{method:'POST',body:JSON.stringify({action:'issueEventInvite',payload:{boothId:project.boothId,projectId:project.id}})});
   const link=`${window.location.origin}${window.location.pathname}#/invite?code=${invite.token}`;
   setInviteLink(link);
   try{await navigator.clipboard.writeText(link);showCopied();}catch{/* 입력창의 링크를 직접 복사 */}
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const lock=useRef(false);
 const load=async(background=false)=>{const next=await request(`/api/booths?workspace=access&projectId=${encodeURIComponent(project.id)}&boothId=${encodeURIComponent(project.boothId)}`,background?{background:true}:undefined);setData(next);};
 useEffect(()=>{let active=true;request(`/api/booths?workspace=access&projectId=${encodeURIComponent(project.id)}&boothId=${encodeURIComponent(project.boothId)}`).then(d=>{if(active)setData(d);}).catch(e=>{if(active){setError(e.message);if([401,403,404].includes(e.status))setData(null);}});return()=>{active=false;};},[request,project.id,readRevision]);
 const run=async command=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setPending(command);try{await beforeChange?.(command.action);const result=await request('/api/booths',{method:'POST',body:JSON.stringify(command)});if(command.action==='saveEventAccess'&&result.profiles&&result.staff)setData(result);else await load(command.action==='saveEventAccess');await onChange?.(command.action,result);setPending(null);return result;}catch(e){setError(e.message);if(e.status>=400&&e.status<500){setPending(null);if(e.status===409)await load(command.action==='saveEventAccess').catch(()=>{});}}finally{setBusy(false);lock.current=false;}};
 const send=(action,payload)=>run({action,payload:{boothId:project.boothId,projectId:project.id,...payload,requestId:crypto.randomUUID()}});
 const disabled=busy||Boolean(pending);
 const accountProfile=data?.profiles.find(p=>p.owner_id===accountOwnerId&&p.status==='active'&&p.linked_user_id);
 const accountStaff=data?.staff.find(s=>s.user_id===accountProfile?.linked_user_id&&s.status==='active');
 const accountRole=accountProfile&&(['owner','manager'].includes(accountProfile.booth_role)?'운영자':accountStaff?.role==='assistant'?'부관리자':accountStaff?.role==='seller'||accountProfile.booth_role==='seller'?'부스참여자':'참여 제작자');
 useEffect(()=>{if(accountProfile)accountDialog.current?.showModal();else accountDialog.current?.close();},[accountOwnerId,Boolean(accountProfile)]);
 useEffect(()=>{setAccountOwnerId(null);},[project.id,project.boothId]);
 const changeRole=async(profile,role)=>{
  if(disabled||['owner','manager'].includes(profile.booth_role)||!['seller','assistant'].includes(role))return;
  if(!profile.linked_user_id)return send('saveEventAccess',{ownerId:profile.owner_id,role,status:'active',version:profile.version||0});
  const staff=data.staff.find(row=>row.user_id===profile.linked_user_id);
  return send('saveEventAccess',{targetUserId:profile.linked_user_id,role,status:'active',version:staff?.version||0});
 };
 const unlink=async profile=>{
  if(disabled||!profile.can_unlink)return;
  if(!await confirmAction('이 제작자와 계정의 연결을 모든 행사에서 해제할까요? 제작자·상품·재고·판매·정산 기록은 유지됩니다. 모든 기기의 미동기화 주문을 먼저 처리해주세요.',{title:'계정 연결 해제',confirmLabel:'연결 해제'}))return;
  const result=await send('unlinkEventArtistAccount',{ownerId:profile.owner_id,targetUserId:profile.linked_user_id,version:profile.version||0});
  if(result?.unlinked)setAccountOwnerId(null);
 };
 return <div className="event-access-panel">
 {error&&<p role="alert" className="inventory-error">{error}</p>}{pending&&!busy&&<button className="management-back" onClick={()=>run(pending)}>같은 요청 다시 확인</button>}
 <section className="management-product"><div className="management-product-header"><h2>참여 제작자</h2><div className="event-header-actions"><button type="button" className="management-back" disabled={disabled} onClick={copyInvite}>초대 링크 복사</button><button type="button" className="management-add" disabled={disabled} onClick={()=>{setError('');setLinkProfile({mode:'add'});}}>제작자 추가</button></div></div><div className="account-card-body">

  <div className="management-table-wrap event-participant-table-wrap"><table className="management-table event-participant-table"><thead><tr><th scope="col">제작자</th><th scope="col">등록 상품</th><th scope="col">참여일</th><th scope="col">행사 권한</th><th scope="col">관리</th></tr></thead><tbody>
  {data?.profiles.filter(p=>p.status==='active'&&(p.display_name!=='미지정'||p.linked_user_id)).map(p=>{const staff=data.staff.find(s=>s.user_id===p.linked_user_id);return <tr key={p.owner_id}>
   <td>{p.linked_user_id?<button type="button" className="event-account-link" aria-label={`${p.nickname||p.linked_user_id} 계정 정보`} onClick={()=>setAccountOwnerId(p.owner_id)}>{p.avatar&&<img className="header-avatar" src={p.avatar} alt="" width="28" height="28"/>}<span>{p.nickname||p.display_name}({p.linked_user_id})</span></button>:<div className="event-creator-cell"><span>{p.nickname||p.display_name}</span><button type="button" className="management-back event-participant-link" disabled={disabled||p.status!=='active'||p.booth_status==='ended'} onClick={()=>{setError('');setLinkProfile(p);}}>+연결</button></div>}</td><td>{p.product_count||0}개</td><td>{p.joined_at?new Date(p.joined_at).toLocaleDateString('ko-KR'):'-'}</td>
   <td>{['owner','manager'].includes(p.booth_role)?'운영자':<label><span className="sr-only">{p.nickname||p.display_name} 행사 권한</span><select aria-label={`${p.nickname||p.display_name} 행사 권한`} disabled={disabled||['owner','manager'].includes(p.booth_role)} value={['owner','manager'].includes(p.booth_role)?'operator':staff?.status==='active'?staff.role:p.booth_role==='seller'?'seller':!p.linked_user_id&&p.requested_role?p.requested_role:'none'} onChange={e=>changeRole(p,e.target.value)}>{['owner','manager'].includes(p.booth_role)&&<option value="operator">운영자</option>}<option value="none" disabled>권한 선택</option><option value="seller">부스참여자</option><option value="assistant">부관리자</option></select></label>}</td>
   <td><div className="event-participant-actions">{!['owner','manager'].includes(p.booth_role)&&<button type="button" className="management-delete" disabled={disabled} onClick={async()=>{if(await confirmAction('이 제작자를 행사에서 삭제할까요? 재고와 이전 판매·정산은 유지하고 상품의 제작자 연결을 해제합니다.',{title:'참여 제작자 삭제',confirmLabel:'삭제'}))await send('removeEventArtist',{ownerId:p.owner_id,version:p.version||0});}}>삭제</button>}</div></td>
  </tr>;})}
  </tbody></table></div>
 </div></section>
 <dialog ref={inviteDialog} className="app-confirm-dialog event-account-dialog" aria-labelledby="event-invite-title" onClose={()=>setInviteLink('')}>
  <div className="management-heading"><h2 id="event-invite-title">제작자 초대 링크</h2><button type="button" className="management-back" onClick={()=>setInviteLink('')}>닫기</button></div>
  <div className="event-invite-copy"><input readOnly aria-label="초대 링크" value={inviteLink} ref={inviteInput} onFocus={e=>e.target.select()}/><button type="button" className="management-add" onClick={copyLink}>복사</button></div>
  {copied&&<div role="status" className="event-copy-toast"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>링크가 복사되었습니다</div>}
 </dialog>
 <dialog ref={accountDialog} className="app-confirm-dialog event-account-dialog" aria-labelledby="event-account-details-title" onCancel={()=>setAccountOwnerId(null)}>
  <div className="management-heading"><h2 id="event-account-details-title">계정 정보</h2><button type="button" className="management-back" onClick={()=>setAccountOwnerId(null)}>닫기</button></div>
  {accountProfile&&<><div className="event-account-identity">{accountProfile.avatar&&<img className="account-avatar" src={accountProfile.avatar} alt="" width="48" height="48"/>}<strong>{accountProfile.nickname||accountProfile.linked_user_id}</strong></div><dl className="account-details"><div><dt>계정 아이디</dt><dd>{accountProfile.linked_user_id}</dd></div><div><dt>제작자</dt><dd>{accountProfile.display_name==='미지정'?accountProfile.nickname||accountProfile.linked_user_id:accountProfile.display_name}</dd></div><div><dt>행사 권한</dt><dd>{accountRole}</dd></div><div><dt>등록 상품</dt><dd>{accountProfile.product_count||0}개</dd></div></dl>{accountProfile.can_unlink&&<div className="event-account-actions"><button type="button" className="management-delete" disabled={disabled} onClick={()=>unlink(accountProfile)}>연결 해제</button></div>}</>}
 </dialog>
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
