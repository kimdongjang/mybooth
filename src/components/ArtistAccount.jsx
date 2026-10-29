import { useEffect, useState } from 'react';
import { Input } from './PosUI';
import { won } from '../utils/productDisplay';

const auditNames={profile_created:'프로필 생성',invitation_issued:'초대 발급',invitation_revoked:'초대 철회',profile_linked:'계정 연결',profile_linked_by_operator:'계정 연결',profile_unlinked_by_operator:'계정 연결 해제'};

export default function ArtistAccount({request,onCompatibility,mode='all'}) {
  const [home,setHome]=useState(null);
  const [participants,setParticipants]=useState(null);
  const [boothId,setBoothId]=useState('');
  const [boothName,setBoothName]=useState('');
  const [proxyName,setProxyName]=useState('');
  const [code,setCode]=useState('');
  const [preview,setPreview]=useState(null);
  const [consent,setConsent]=useState(false);
  const [allowOperatorStock,setAllowOperatorStock]=useState(true);
  const [issued,setIssued]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const post=(action,payload)=>request('/api/booths',{method:'POST',body:JSON.stringify({action,payload})});
  const reload=async()=>{
    const data=await request('/api/booths?artists=history');
    setHome(data);
    onCompatibility?.(data.compatibility);
    setBoothId(current=>data.booths.some(b=>b.id===current)?current:data.booths.find(b=>['owner','manager'].includes(b.role))?.id || '');
    if(boothId) setParticipants(await request(`/api/booths?artists=participants&boothId=${encodeURIComponent(boothId)}`));
  };
  useEffect(()=>{let active=true;request('/api/booths?artists=history').then(data=>{if(active){setHome(data);onCompatibility?.(data.compatibility);setBoothId(data.booths.find(b=>['owner','manager'].includes(b.role))?.id || '');}}).catch(err=>{if(active)setError(err.message);});return()=>{active=false;};},[request,onCompatibility]);
  useEffect(()=>{
    setParticipants(null);setIssued(null);
    if(!boothId)return;
    let active=true;
    request(`/api/booths?artists=participants&boothId=${encodeURIComponent(boothId)}`).then(data=>{if(active)setParticipants(data);}).catch(err=>{if(active)setError(err.message);});
    return()=>{active=false;};
  },[boothId,request]);
  const run=async work=>{if(busy)return;setBusy(true);setError('');try{await work();}catch(err){setError(err.message);}finally{setBusy(false);}};
  const operators=home?.booths.filter(b=>['owner','manager'].includes(b.role)) || [];
  return <section className="management-product">
    <div className="management-product-header"><h2>제작자·부스</h2></div>
    <div className="account-card-body">
      {error && <p role="alert" className="inventory-error">{error}</p>}
      {home && <>
        {home.profiles.length>0 && <ul>{home.profiles.map(p=><li key={p.id}>{p.display_name}</li>)}</ul>}
        {mode!=='profile'&&!home.booths.some(b=>b.role==='owner') && <form className="account-form" onSubmit={e=>{e.preventDefault();run(async()=>{await post('createFirstBooth',{name:boothName});setBoothName('');await reload();});}}>
          <label>부스명<Input required maxLength={80} value={boothName} onChange={setBoothName} disabled={busy}/></label>
          <button className="management-add" disabled={busy}>부스 만들기</button>
        </form>}
        <form className="account-form" onSubmit={e=>{e.preventDefault();run(async()=>{setPreview(null);setConsent(false);const data=await post('previewArtistInvitation',{token:code.trim()});setPreview(data.invitation);setAllowOperatorStock(data.allowOperatorStock!==false);});}}>
          <label>제작자 초대 코드<Input required value={code} maxLength={64} onChange={value=>{setCode(value);setPreview(null);setConsent(false);}} disabled={busy} autoComplete="off"/></label>
          <button className="management-add" disabled={busy}>연결 내용 확인</button>
        </form>
        {preview && <div className="account-form">
          <dl className="account-details"><div><dt>부스</dt><dd>{preview.boothName}</dd></div><div><dt>제작자</dt><dd>{preview.artistName}</dd></div><div><dt>초대 만료</dt><dd>{new Date(preview.expiresAt).toLocaleString('ko-KR')}</dd></div></dl>
          {!preview.accepted && <><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy}/>이 제작자 프로필을 내 계정에 연결하는 데 동의합니다.</label>
            <label className="stock-permission-checkbox"><input type="checkbox" checked={allowOperatorStock} disabled={busy} onChange={e=>setAllowOperatorStock(e.target.checked)}/>행사 운영자의 재고관리 허용</label>
            <button type="button" className="management-add" disabled={busy || !consent} onClick={()=>run(async()=>{await post('acceptArtistInvitation',{token:code.trim(),acceptSharedStock:consent,allowOperatorStock});setCode('');setPreview(null);setConsent(false);await reload();})}>제작자 연결 수락</button></>}
        </div>}
        {mode!=='profile'&&operators.length>0 && <section>
          <h3>참여 제작자 초대</h3>
          <label>관리 부스<select value={boothId} disabled={busy} onChange={e=>setBoothId(e.target.value)}>{operators.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <form className="account-form" onSubmit={e=>{e.preventDefault();run(async()=>{await post('createBoothArtist',{boothId,name:proxyName});setProxyName('');await reload();});}}>
            <label>참여 제작자명<Input required value={proxyName} maxLength={80} onChange={setProxyName} disabled={busy}/></label>
            <button className="management-add" disabled={busy}>미연동 제작자 추가</button>
          </form>
          {participants?.profiles.map(p=><div key={p.id} className="management-fields"><span>{p.display_name} · {p.status==='linked'?'연결됨':'미연동'}</span>
            {p.status==='unlinked' && p.participation==='proxy' && p.display_name!=='미지정' && <button type="button" className="management-add" disabled={busy} onClick={()=>run(async()=>{setIssued(null);const data=await post('issueArtistInvitation',{boothId,profileId:p.id});setIssued({...data.invitation,artistName:p.display_name});await reload();})}>초대 코드 발급</button>}
          </div>)}
          {issued && <label>{issued.artistName} 초대 코드 · {new Date(issued.expires_at).toLocaleString('ko-KR')} 만료<Input value={issued.token} readOnly aria-label="발급된 초대 코드"/></label>}
          {participants?.invitations.filter(i=>!i.revoked_at && !i.accepted_at && new Date(i.expires_at)>new Date()).map(i=><div key={i.id}>
            <span>{participants.profiles.find(p=>p.id===i.profile_id)?.display_name} · {new Date(i.expires_at).toLocaleString('ko-KR')} 만료</span>
            <button type="button" className="management-delete" disabled={busy} onClick={()=>run(async()=>{await post('revokeArtistInvitation',{boothId,invitationId:i.id});if(issued?.id===i.id)setIssued(null);await reload();})}>초대 철회</button>
          </div>)}
          {participants?.audit.length>0 && <details><summary>연결 감사 이력</summary><ul>{participants.audit.map((a,i)=><li key={i}>{new Date(a.created_at).toLocaleString('ko-KR')} · {auditNames[a.action] || a.action} · {a.actor_id}</li>)}</ul></details>}
        </section>}
        {mode==='all'&&home.events.map(event=><section key={event.projectId}>
          <h3>{event.boothName} / {event.eventName} · {event.closedAt?'확정 정산':'예상 정산'}</h3>
          {event.rows.map(row=><div key={row.recipientId}>
            <h4>{row.artistName}</h4>
            <dl className="account-details"><div><dt>판매액</dt><dd>{won(row.gross)}</dd></div><div><dt>귀속 비용·차감</dt><dd>{won(row.fees)}</dd></div><div><dt>정산금</dt><dd>{won(row.net)}</dd></div><div><dt>지급액</dt><dd>{won(row.paid)}</dd></div><div><dt>{event.closedAt?'미지급':'예상 잔액'}</dt><dd>{won(row.pending)}</dd></div></dl>
            {row.shares.length>0 && <details><summary>내 비용 내역</summary><ul>{row.shares.map((s,i)=><li key={i}>{s.label} · {won(s.amount)}</li>)}</ul></details>}
            {row.payments.length>0 && <details><summary>지급 기록</summary><ul>{row.payments.map(p=><li key={p.id}>{p.paidAt} · {won(p.amount)}</li>)}</ul></details>}
          </div>)}
          {event.sales.length>0 && <details><summary>내 상품 판매 이력</summary><ul>{event.sales.flatMap((s,i)=>s.items.map((item,j)=><li key={`${i}:${j}`}>{new Date(s.time).toLocaleString('ko-KR')}{s.voided?' · 취소됨':''} · {item.name} · {item.quantity}개 · {won(item.amount)}</li>))}</ul></details>}
        </section>)}
        {home.links.length>0 && <details><summary>내 프로필 연결 출처</summary><ul>{home.links.map((a,i)=><li key={i}>{new Date(a.created_at).toLocaleString('ko-KR')} · {home.profiles.find(p=>p.id===a.profile_id)?.display_name} · {auditNames[a.action] || a.action} · {a.actor_id}</li>)}</ul></details>}
      </>}
    </div>
  </section>;
}
