import {useState,useRef} from 'react';
import { Input } from '../components/PosUI';
import { PageIntro } from '../components/PageLayout';
import Icon from '../components/Icon';
import {eventSchedule,sortEventsBySchedule} from '../utils/eventSchedule';

export default function ProjectsPage({ creating, booths=[], projects, selectedProject, newProjectName, setNewProjectName, onCreateProject, onManageProject, onSelectProject, navigate }) {
  const [mode,setMode]=useState('empty'),[sourceId,setSourceId]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [venue,setVenue]=useState(''),[startsOn,setStart]=useState(''),[endsOn,setEnd]=useState('');
  const pending=useRef(null);
  const fields=<><label className="event-field">행사장 위치<input name="venue" required maxLength={200} value={venue} onChange={e=>setVenue(e.target.value)}/></label><div className="event-create-dates"><label className="event-field">시작일<input name="startsOn" type="date" required value={startsOn} onChange={e=>setStart(e.target.value)}/></label><label className="event-field">종료일<input name="endsOn" type="date" required min={startsOn||undefined} value={endsOn} onChange={e=>setEnd(e.target.value)}/></label></div></>;
  const sources=projects.filter(p=>p.permissions?.canManage!==false);
  const copy=async e=>{e.preventDefault();if(busy||!password||!sourceId||!newProjectName.trim())return;setBusy(true);setError('');try{const project=sources.find(p=>p.id===sourceId);pending.current||={project,payload:{name:newProjectName.trim(),venue,startsOn,endsOn,password,requestId:crypto.randomUUID()}};const result=await onManageProject(pending.current.project,'duplicateProject',pending.current.payload);pending.current=null;setPassword('');await onSelectProject(result.project);}catch(e){setError(e.message);if(e.status>=400&&e.status<500)pending.current=null;}finally{setBusy(false);}};
  const managedBooths = booths.filter(booth => ['owner', 'manager'].includes(booth.role));
  return <>
    <nav className="event-subnav inventory-management-nav menu-tabs" aria-label="행사 선택 하위 메뉴"><button type="button" aria-current={!creating?'page':undefined} onClick={()=>navigate('projects')}>행사 선택</button><button data-guide={!creating?'event':undefined} type="button" aria-current={creating?'page':undefined} onClick={()=>navigate('projectNew')}>새 행사 추가</button></nav>
    <main className="page-content projects-page"><div className="page-body event-picker">
    {creating?<PageIntro title="새 행사 추가"/>:<h1 className="sr-only">행사 선택</h1>}
    <div>
      {creating ? <><div className="page-tabs purchase-tabs menu-tabs" role="group" aria-label="새 행사 만들기 방식"><button type="button" disabled={busy||Boolean(pending.current)} aria-pressed={mode==='empty'} onClick={()=>setMode('empty')}>빈 행사로 시작</button><button type="button" disabled={busy||Boolean(pending.current)} aria-pressed={mode==='copy'} onClick={()=>setMode('copy')}>지난 행사 구성 가져오기</button><button type="button" disabled={busy||Boolean(pending.current)} onClick={()=>navigate('restore')}>백업 파일에서 복원</button></div>{mode==='copy'?<form onSubmit={copy} className="event-panel account-form"><h2>지난 행사 구성으로 새 행사 만들기</h2><p>상품·세트·가격·제작자 구성을 가져옵니다. 배정 재고와 판매 내역은 0으로 시작합니다.</p><fieldset disabled={busy||Boolean(pending.current)} className="event-form-fields"><label>가져올 행사<select required value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">행사 선택</option>{sources.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>새 행사 이름<Input required maxLength={100} value={newProjectName} onChange={setNewProjectName}/></label>{fields}<label>계정 비밀번호<Input required type="password" autoComplete="current-password" value={password} onChange={setPassword}/></label></fieldset><button className="management-add" disabled={busy||!sourceId||!password||!newProjectName.trim()}>{pending.current?'같은 요청 다시 확인':'새 행사 만들기'}</button>{error&&<p role="alert">{error}</p>}</form>:<form onSubmit={onCreateProject} className="event-panel event-create-form">
        {managedBooths.length > 1 ? <label className="event-field">운영 부스<select name="boothId" required>{managedBooths.map(booth => <option key={booth.id} value={booth.id}>{booth.name}</option>)}</select></label> : <input type="hidden" name="boothId" value={managedBooths[0]?.id || ''} />}
        <h2>새 행사 만들기</h2><p>상품·세트·판매 내역이 없는 행사로 시작합니다.</p>
        <label className="event-field">행사 이름<Input required maxLength={100} value={newProjectName} onChange={setNewProjectName} placeholder="예: 10월 서코행사" /></label>
        {fields}
        <button data-guide="eventSave" className="event-button event-button-primary">행사 만들고 판매 화면 열기</button>
      </form>}</> : <div className="project-grid grid gap-3 md:grid-cols-2">
        {sortEventsBySchedule(projects).map(project => {const schedule=eventSchedule(project);return <article key={project.id} className="event-picker-entry"><button type="button" onClick={() => onSelectProject(project)} className="event-picker-card" aria-pressed={selectedProject?.id === project.id}>
          <span className="event-picker-badges"><span className={`inventory-event-status is-${schedule.status}`}>{schedule.label}</span>{schedule.countdown&&<span className="event-countdown">{schedule.countdown}</span>}</span>
          <strong className="event-picker-heading"><span>{project.boothName&&!/^기본\s*부스$/.test(project.boothName.trim())?`${project.boothName} · `:''}{project.name}</span>{schedule.period&&<time dateTime={project.startsOn}>{schedule.period}</time>}</strong>
          {project.venue&&<span className="event-muted">{project.venue}</span>}
          <span className="event-muted">생성일 {new Date(project.createdAt).toLocaleDateString('ko-KR')}{selectedProject?.id === project.id ? ' · 현재 선택한 행사' : ''}</span>
          {project.summary && <span className="event-summary"><span>판매 {project.summary.sales.toLocaleString()}건 · {project.summary.total.toLocaleString()}원</span><span>상품 {project.summary.products.toLocaleString()}종 · 남은 재고 {project.summary.remainingStock.toLocaleString()}개</span><small>서버 동기화 완료 기준</small></span>}
          <span className="event-picker-action">{project.archivedAt?'행사 내역 열기':project.permissions?.canSell?'판매 화면 열기':project.permissions?.canViewPos?'상품 목록 열기':'내 정산 열기'} →</span>
        </button>{project.permissions?.canManage!==false&&<details className="event-picker-more"><summary aria-label={`${project.name} 행사 메뉴`}>⋯</summary><div className="event-picker-menu"><a className="event-picker-menu-item" href={`#/project?projectId=${encodeURIComponent(project.id)}`}><Icon name="project"/>행사 관리</a><button type="button" className="event-picker-menu-item" onClick={()=>{setSourceId(project.id);setMode('copy');setNewProjectName(`${project.name} 새 행사`.slice(0,100));navigate('projectNew');}}><Icon name="projects"/>이 행사 구성으로 새 행사 만들기</button></div></details>}</article>;})}
      </div>}

    </div>
  </div></main></>;
}
