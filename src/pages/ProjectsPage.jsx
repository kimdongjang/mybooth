import { useState } from 'react';
import { Input } from '../components/PosUI';
import { PageIntro, PageTabs } from '../components/PageLayout';

export default function ProjectsPage({ projects, selectedProject, newProjectName, setNewProjectName, onCreateProject, onSelectProject, navigate }) {
  const [tab, setTab] = useState('list');
  return <main className="page-content projects-page"><div className="page-body event-picker">
    <PageIntro title="행사 선택" description="운영할 행사를 선택하면 판매 화면으로 이동합니다. 행사별 설정은 판매 화면의 ‘행사 관리’에서 변경하세요.">
      <PageTabs id="projects" label="행사 선택" tabs={[["list", "행사 목록"], ["new", "새 행사"]]} selected={tab} onSelect={setTab} />
    </PageIntro>
    <div id={`projects-panel-${tab}`} role="tabpanel" aria-labelledby={`projects-tab-${tab}`} tabIndex={0}>
      {tab === 'new' ? <form onSubmit={onCreateProject} className="event-panel event-create-form">
        <h2>새 행사 만들기</h2><p>상품·세트·판매 내역이 없는 행사로 시작합니다.</p>
        <label className="event-field">행사 이름<Input required maxLength={100} value={newProjectName} onChange={setNewProjectName} placeholder="예: 10월 서코행사" /></label>
        <button className="event-button event-button-primary">행사 만들고 판매 화면 열기</button>
      </form> : <div className="project-grid grid gap-3 md:grid-cols-2">
        {projects.map(project => <button key={project.id} type="button" onClick={() => onSelectProject(project)} className="event-picker-card" aria-pressed={selectedProject?.id === project.id}>
          <span className="event-status" data-archived={Boolean(project.archivedAt)}>{project.archivedAt ? '보관 중' : '진행 중'}</span>
          <strong>{project.name}</strong>
          <span className="event-muted">생성일 {new Date(project.createdAt).toLocaleDateString('ko-KR')}{selectedProject?.id === project.id ? ' · 현재 선택한 행사' : ''}</span>
          <span className="event-picker-action">{project.archivedAt ? '행사 내역 열기' : '판매 화면 열기'} →</span>
        </button>)}
        {!projects.length && <div className="event-panel"><h2>등록된 행사가 없습니다</h2><p>새 행사를 만들거나 기존 프로젝트 백업을 복원해 시작하세요.</p><button className="event-button" onClick={() => setTab('new')}>새 행사 만들기</button></div>}
      </div>}
      {!projects.length && <div className="event-picker-restore"><p>기존 행사 백업 파일이 있나요?</p><button type="button" className="event-text-link" onClick={() => navigate('restore')}>백업 파일로 새 행사 복원 →</button></div>}
    </div>
  </div></main>;
}
