import {useState,useEffect,useRef} from 'react';
import EventSettlementPanel from '../components/EventSettlementPanel';
import EventAccessPanel from '../components/EventAccessPanel';
import {Input} from '../components/PosUI';
import ProjectNavigation from '../components/ProjectNavigation';

export default function ProjectManagementPage({page,project,navigate,onManageProject,request,onSettlementChange,onAccessChange,beforeAccessChange}) {
 const [name,setName]=useState(project.name),[password,setPassword]=useState(''),[confirmName,setConfirmName]=useState('');
 const [venue,setVenue]=useState(project.venue||''),[boothName,setBoothName]=useState(project.boothName||''),boothRenamed=useRef(false);
 const [startsOn,setStart]=useState(''),[endsOn,setEnd]=useState(''),[scheduleReady,setScheduleReady]=useState(!request);
 const pending=useRef(null);
 useEffect(()=>{let active=true;if(!request)return;setScheduleReady(false);request(`/api/booths?workspace=access&projectId=${encodeURIComponent(project.id)}&boothId=${encodeURIComponent(project.boothId)}`).then(data=>{if(active){setStart(data.schedule?.starts_on||'');setEnd(data.schedule?.ends_on||'');setScheduleReady(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request,project.id]);
 const [operation,setOperation]=useState(page==='projectArchive'?'archive':page==='projectDelete'?'delete':'backup');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const info=['project','projectName'].includes(page),data=!info&&page!=='projectSettlement',archived=Boolean(project.archivedAt);
 const action=info?'updateProjectInfo':operation==='backup'?'backupProject':operation==='delete'?'deleteProject':archived?'unarchiveProject':'archiveProject';
 const label=info?'행사 정보 저장':operation==='backup'?'백업 다운로드':operation==='delete'?'삭제하기':archived?'판매 다시 열기':'판매 종료하고 기록 보관';
 const needsPassword=['archiveProject','deleteProject'].includes(action);
 const submit=async e=>{e.preventDefault();if(busy||needsPassword&&!password||info&&(!scheduleReady||archived))return;setBusy(true);setError('');try{
  if(info)pending.current||={name,venue,startsOn,endsOn,requestId:crypto.randomUUID()};
  const nextBooth=boothName.trim();
  if(info&&request&&nextBooth&&nextBooth!==project.boothName&&!boothRenamed.current){await request('/api/booths',{method:'POST',body:JSON.stringify({action:'saveBoothManagement',payload:{boothId:project.boothId,name:nextBooth,expectedName:project.boothName,requestId:crypto.randomUUID()}})});boothRenamed.current=true;}
  await onManageProject(project,action,info?pending.current:{name,confirmName,...(needsPassword?{password}:{})});pending.current=null;boothRenamed.current=false;setPassword('');
 }catch(e){setError(e.message);if(e.status>=400&&e.status<500)pending.current=null;}finally{setBusy(false);}};
 const choose=value=>{setOperation(value);setPassword('');setConfirmName('');setError('');};
 return <main className="page-content event-management-page"><div className="event-workspace">
  <ProjectNavigation page={page} project={project} navigate={navigate}/><div className="event-main">
  {page==='projectSettlement'?<EventSettlementPanel request={request} projectId={project.id} onChange={onAccessChange} beforeChange={beforeAccessChange}/>:<>
   {info?<>
    <section className="management-product"><header className="management-product-header"><h2>행사 정보</h2><div className="event-header-actions"><span className="event-status" data-archived={archived}>{archived?'판매 종료(보관됨)':'진행 중'}</span><button type="submit" form="event-info-form" className="management-add" disabled={busy||archived||!scheduleReady||!name.trim()}>{pending.current?'같은 요청 다시 확인':'행사 정보 저장'}</button></div></header><div className="account-card-body">
    <form id="event-info-form" className="account-form event-info-form" onSubmit={submit}><label>행사 이름<Input required maxLength={100} value={name} onChange={setName} disabled={busy||archived||Boolean(pending.current)}/></label><label>부스 이름<Input required maxLength={80} value={boothName} onChange={setBoothName} disabled={busy||archived||Boolean(pending.current)}/></label><label>행사장 위치<Input maxLength={200} value={venue} onChange={setVenue} disabled={busy||archived||Boolean(pending.current)}/></label><label>판매 시작일<input type="date" value={startsOn} required={Boolean(endsOn)} disabled={busy||archived||!scheduleReady||Boolean(pending.current)} onChange={e=>setStart(e.target.value)}/></label><label>판매 종료일<input type="date" value={endsOn} min={startsOn||undefined} required={Boolean(startsOn)} disabled={busy||archived||!scheduleReady||Boolean(pending.current)} onChange={e=>setEnd(e.target.value)}/></label></form>
    </div></section>{request&&<EventAccessPanel request={request} project={project} onChange={onAccessChange} beforeChange={beforeAccessChange}/>}
   </>:null}
   {data&&<>
    <section className="management-product"><header className="management-product-header"><h2>데이터·관리</h2></header><div className="account-card-body event-data-actions">
     <div><h3>데이터 백업 받기</h3><button type="button" className="management-back" disabled={busy} onClick={()=>choose('backup')}>백업 다운로드</button></div>
     <div><h3>판매 종료 (기록 보관)</h3><button type="button" className="management-back" disabled={busy} onClick={()=>choose('archive')}>{archived?'판매 다시 열기':'판매 종료'}</button></div>
    </div></section>
    <section className="management-product event-danger-panel"><header className="management-product-header"><h2>위험 구역</h2></header><div className="account-card-body event-data-actions"><div><h3>행사 삭제</h3><button type="button" className="management-delete" disabled={busy} onClick={()=>choose('delete')}>삭제하기</button></div></div></section>
    <section className="management-product"><header className="management-product-header"><h2>{label}</h2></header><div className="account-card-body">
     <form className="account-form" onSubmit={submit}><fieldset disabled={busy} className="event-form-fields">
      {operation==='backup'&&<p>이 행사의 상품·세트·배정 재고·판매·비용·정산을 저장합니다. 이미지 파일과 미동기화 주문은 제외됩니다. 전체 행사 백업은 마이페이지에서 받을 수 있습니다.</p>}
      {operation==='archive'&&<p>{archived?'상품·재고·판매 기록을 유지하고 판매·취소·상품 수정을 다시 허용합니다.':'판매·취소·상품 수정을 잠그고 기록을 보관합니다. 정산 조회와 백업은 유지됩니다.'}</p>}
      {operation==='delete'&&<><p>행사를 목록과 운영 화면에서 삭제하고 남은 재고를 미배정으로 돌려놓습니다. 공통 재고와 이전 판매·정산 이력은 보존합니다.</p><button type="button" className="management-back" onClick={()=>choose('backup')}>삭제 전 백업 다운로드</button><label>삭제할 행사 이름<Input required value={confirmName} onChange={setConfirmName}/></label></>}
      {needsPassword&&<label>계정 비밀번호<Input type="password" autoComplete="current-password" required value={password} onChange={setPassword}/></label>}
      <button className={operation==='delete'?'management-delete':'management-add'} disabled={busy||needsPassword&&!password||(operation==='delete'&&confirmName!==project.name)}>{busy?'처리 중…':label}</button>
     </fieldset></form>
    </div></section>
   </>}
  </>}{error&&<p role="alert" className="event-error">{error}</p>}
  </div></div></main>;
}
