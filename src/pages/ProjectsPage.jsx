import {useState,useRef} from 'react';
import { Input } from '../components/PosUI';
import { PageIntro } from '../components/PageLayout';
import Icon from '../components/Icon';
import {eventSchedule,sortEventsBySchedule} from '../utils/eventSchedule';
import {eventActionLabel} from '../utils/eventNavigation';

export default function ProjectsPage({ creating, booths=[], projects, selectedProject, newProjectName, setNewProjectName, onCreateProject, onManageProject, onSelectProject, navigate }) {
  const [mode,setMode]=useState('empty'),[sourceId,setSourceId]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [venue,setVenue]=useState(''),[startsOn,setStart]=useState(''),[endsOn,setEnd]=useState('');
  const pending=useRef(null);
  const fields=<><label className="event-field">행사장 위치<input name="venue" required maxLength={200} value={venue} onChange={e=>setVenue(e.target.value)}/></label><div className="event-create-dates"><label className="event-field">시작일<input name="startsOn" type="date" required value={startsOn} onChange={e=>setStart(e.target.value)}/></label><label className="event-field">종료일<input name="endsOn" type="date" required min={startsOn||undefined} value={endsOn} onChange={e=>setEnd(e.target.value)}/></label></div></>;
  const sources=projects.filter(p=>p.permissions?.canManage!==false);
  const copy=async e=>{e.preventDefault();if(busy||!password||!sourceId||!newProjectName.trim())return;setBusy(true);setError('');try{const project=sources.find(p=>p.id===sourceId);pending.current||={project,payload:{name:newProjectName.trim(),venue,startsOn,endsOn,password,requestId:crypto.randomUUID()}};const result=await onManageProject(pending.current.project,'duplicateProject',pending.current.payload);pending.current=null;setPassword('');await onSelectProject(result.project);}catch(e){setError(e.message);if(e.status>=400&&e.status<500)pending.current=null;}finally{setBusy(false);}};
  const managedBooths = booths.filter(booth => ['owner', 'manager'].includes(booth.role));
  const sortedProjects = sortEventsBySchedule(projects);
  const eventGroups = [
    {id:'active',title:'진행 중인 행사',statuses:['active']},
    {id:'upcoming',title:'예정된 행사',statuses:['upcoming']},
    {id:'unscheduled',title:'일정 미설정',statuses:['unscheduled']},
    {id:'past',title:'종료 · 정산 마감 · 보관',statuses:['ended','closed','archived']},
  ].map(group=>({...group,projects:sortedProjects.filter(project=>
    group.statuses.includes(eventSchedule(project).status)
  )})).filter(group=>group.projects.length);
  return <>
    <nav className="event-subnav inventory-management-nav menu-tabs" aria-label="행사 목록 하위 메뉴"><button type="button" aria-current={!creating?'page':undefined} onClick={()=>navigate('projects')}>행사 목록</button><button data-guide={!creating?'event':undefined} type="button" aria-current={creating?'page':undefined} onClick={()=>navigate('projectNew')}>새 행사 추가</button></nav>
    <main className="page-content projects-page"><div className="page-body event-picker">
    <PageIntro title={creating ? "새 행사 추가" : "행사 목록"}/>
    <div>
      {creating ? <><div className="page-tabs purchase-tabs menu-tabs" role="group" aria-label="새 행사 만들기 방식"><button type="button" disabled={busy||Boolean(pending.current)} aria-pressed={mode==='empty'} onClick={()=>setMode('empty')}>빈 행사로 시작</button><button type="button" disabled={busy||Boolean(pending.current)} aria-pressed={mode==='copy'} onClick={()=>setMode('copy')}>지난 행사 구성 가져오기</button><button type="button" disabled={busy||Boolean(pending.current)} onClick={()=>navigate('restore')}>백업 파일에서 복원</button></div>{mode==='copy'?<form onSubmit={copy} className="event-panel account-form"><h2>지난 행사 구성으로 새 행사 만들기</h2><p>상품·세트·가격·제작자 구성을 가져옵니다. 배정 재고와 판매 내역은 0으로 시작합니다.</p><fieldset disabled={busy||Boolean(pending.current)} className="event-form-fields"><label>가져올 행사<select required value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">행사 선택</option>{sources.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>새 행사 이름<Input required maxLength={100} value={newProjectName} onChange={setNewProjectName}/></label>{fields}<label>계정 비밀번호<Input required type="password" autoComplete="current-password" value={password} onChange={setPassword}/></label></fieldset><button className="management-add" disabled={busy||!sourceId||!password||!newProjectName.trim()}>{pending.current?'같은 요청 다시 확인':'새 행사 만들기'}</button>{error&&<p role="alert">{error}</p>}</form>:<form onSubmit={onCreateProject} className="event-panel event-create-form">
        {managedBooths.length > 1 ? <label className="event-field">운영 부스<select name="boothId" required>{managedBooths.map(booth => <option key={booth.id} value={booth.id}>{booth.name}</option>)}</select></label> : <input type="hidden" name="boothId" value={managedBooths[0]?.id || ''} />}
        <h2>새 행사 만들기</h2><p>상품·세트·판매 내역이 없는 행사로 시작합니다.</p>
        <label className="event-field">행사 이름<Input required maxLength={100} value={newProjectName} onChange={setNewProjectName} placeholder="예: 10월 서코행사" /></label>
        {fields}
        <button data-guide="eventSave" className="event-button event-button-primary">행사 만들고 판매 화면 열기</button>
      </form>}</> : <div className="event-picker-groups">
        {eventGroups.map(group=><section key={group.id} className={`event-picker-group is-${group.id}`} aria-labelledby={`event-group-${group.id}`}>
          <header className="event-picker-group-heading"><h2 id={`event-group-${group.id}`}>{group.title}</h2><span className="event-picker-group-count">{group.projects.length}개</span></header>
          <div className="event-list">
            {group.projects.map(project => {
              const schedule = eventSchedule(project);
              const selected = selectedProject?.id === project.id;
              return <article key={project.id} className={`event-list-row${selected ? ' is-selected' : ''}`}>
                <div className="event-list-info">
                  <div className="event-list-name"><h3>{project.boothName && !/^기본\s*부스$/.test(project.boothName.trim()) && <span>{project.boothName} · </span>}{project.name}</h3>{selected && <span className="event-current-label">✓ 선택된 행사</span>}</div>
                  <div className="event-list-meta"><span className={`inventory-event-status is-${schedule.status}`}>{schedule.label}</span><span>{schedule.period || '일정 미설정'}</span>{project.venue && <span>{project.venue}</span>}</div>
                </div>
                <button type="button" className="event-list-open" aria-label={`${project.name} · ${eventActionLabel(project)}`} onClick={() => onSelectProject(project)}>{eventActionLabel(project)} →</button>
                {project.permissions?.canManage && <details className="event-list-more"><summary aria-label={`${project.name} 행사 메뉴`}>⋯</summary><div className="event-picker-menu">
                  <a className="event-picker-menu-item" href={`#/project/manage?projectId=${encodeURIComponent(project.id)}`}><Icon name="project"/>행사 관리</a>
                  <button type="button" className="event-picker-menu-item" onClick={() => {setSourceId(project.id);setMode('copy');setNewProjectName(`${project.name} 새 행사`.slice(0,100));navigate('projectNew');}}>이 행사 구성으로 새 행사 만들기</button>
                </div></details>}
              </article>;
            })}
          </div>
        </section>)}
      </div>}

    </div>
  </div></main></>;
}
