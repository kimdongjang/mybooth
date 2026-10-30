import {useEffect,useRef,useState} from 'react';

export default function ContractRetirement({request,beforeClose}) {
  const [booths,setBooths]=useState([]),[boothId,setBooth]=useState(''),[report,setReport]=useState(null);
  const [password,setPassword]=useState(''),[checked,setChecked]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const pending=useRef(null),lock=useRef(false);
  useEffect(()=>{let active=true;request('/api/booths?artists=home').then(data=>{if(active){const own=data.booths.filter(b=>b.role==='owner');setBooths(own);setBooth(own[0]?.id||'');}}).catch(err=>{if(active)setError(err.message);});return()=>{active=false;};},[request]);
  useEffect(()=>{
    setReport(null);setChecked(false);setPassword('');pending.current=null;
    if(!boothId)return;let active=true;
    request(`/api/booths?contracts=legacy&boothId=${encodeURIComponent(boothId)}`).then(data=>{if(active)setReport(data);}).catch(err=>{if(active)setError(err.message);});return()=>{active=false;};
  },[boothId,request]);
  const run=async event=>{
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      const closed=pending.current?.closed??!report.policy.legacyWritesClosed;
      if(closed&&!pending.current)await beforeClose();
      pending.current||={boothId,version:report.policy.version,expectedFingerprint:report.fingerprint,queuesChecked:checked,closed,requestId:crypto.randomUUID()};
      await request('/api/booths',{method:'POST',body:JSON.stringify({action:'changeLegacyContracts',payload:{...pending.current,password}})});
      pending.current=null;setPassword('');setChecked(false);
      setReport(await request(`/api/booths?contracts=legacy&boothId=${encodeURIComponent(boothId)}`));
    } catch(err){setError(err.message);if(err.status>=400&&err.status<500)pending.current=null;if(err.status===409){try{setReport(await request(`/api/booths?contracts=legacy&boothId=${encodeURIComponent(boothId)}`));setChecked(false);}catch{}}}
    finally{lock.current=false;setBusy(false);}
  };
  if(!booths.length&&!error)return null;
  return <section className="management-product"><div className="management-product-header"><h2>구형 쓰기 계약</h2></div><div className="account-card-body">
    {error&&<p role="alert" className="inventory-error">{error}</p>}
    {booths.length>1&&<label>부스<select value={boothId} onChange={e=>setBooth(e.target.value)} disabled={busy}>{booths.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
    {report&&<form className="account-form" onSubmit={run}>
      <dl className="account-details"><div><dt>현재 계약</dt><dd>{report.policy.legacyWritesClosed?'ID 기반 쓰기':'구형 쓰기 호환'}</dd></div><div><dt>ID 매핑</dt><dd>{report.ready?'확인됨':`확인 필요 ${report.issues.length}건`}</dd></div><div><dt>보존 판매</dt><dd>{report.counts.sales}건</dd></div></dl>
      {!report.policy.legacyWritesClosed&&<label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} disabled={busy}/>모든 기기의 주문 동기화와 최신 클라이언트 사용을 확인했습니다.</label>}
      <label>현재 비밀번호<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
      <button className="management-add" disabled={busy||!report.policy.legacyWritesClosed&&(!report.ready||!checked)}>{busy&&<span className="button-spinner" aria-hidden="true"/>}{report.policy.legacyWritesClosed?'구형 쓰기 호환 복구':'구형 쓰기 종료'}</button>
    </form>}
  </div></section>;
}
