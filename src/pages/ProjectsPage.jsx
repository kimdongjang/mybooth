import { Input } from '../components/PosUI';
import { PageIntro } from '../components/PageLayout';

export default function ProjectsPage({ creating, projects, selectedProject, newProjectName, setNewProjectName, onCreateProject, onSelectProject, navigate }) {
  return <main className="page-content projects-page"><div className="page-body event-picker">
    <PageIntro title={creating ? '새 행사 추가' : '행사 선택'} actions={<button data-guide={creating ? undefined : "event"} type="button" className="event-button event-button-primary" onClick={() => navigate(creating ? 'projects' : 'projectNew')}>{creating ? '행사 목록으로' : '새 행사 추가'}</button>} />
    <div>
      {creating ? <form onSubmit={onCreateProject} className="event-panel event-create-form">
        <h2>새 행사 만들기</h2><p>상품·세트·판매 내역이 없는 행사로 시작합니다.</p>
        <label className="event-field">행사 이름<Input required maxLength={100} value={newProjectName} onChange={setNewProjectName} placeholder="예: 10월 서코행사" /></label>
        <button data-guide="eventSave" className="event-button event-button-primary">행사 만들고 판매 화면 열기</button>
      </form> : <div className="project-grid grid gap-3 md:grid-cols-2">
        {projects.map(project => <button key={project.id} type="button" onClick={() => onSelectProject(project)} className="event-picker-card" aria-pressed={selectedProject?.id === project.id}>
          <span className="event-status" data-archived={Boolean(project.archivedAt)}>{project.archivedAt ? '보관 중' : '진행 중'}</span>
          <strong>{project.name}</strong>
          <span className="event-muted">생성일 {new Date(project.createdAt).toLocaleDateString('ko-KR')}{selectedProject?.id === project.id ? ' · 현재 선택한 행사' : ''}</span>
          {project.summary ? <span className="event-summary"><span>판매 {project.summary.sales.toLocaleString()}건 · {project.summary.total.toLocaleString()}원</span><span>상품 {project.summary.products.toLocaleString()}종 · 남은 재고 {project.summary.remainingStock.toLocaleString()}개</span><small>서버 동기화 완료 기준</small></span> : <span className="event-muted">요약 정보는 온라인에서 목록을 새로 불러오면 표시됩니다.</span>}
          <span className="event-picker-action">{project.archivedAt ? '행사 내역 열기' : '판매 화면 열기'} →</span>
        </button>)}
        <button type="button" className="event-picker-card event-picker-add" onClick={() => navigate('projectNew')}><span aria-hidden="true">＋</span><strong>새 행사 추가하기</strong></button>
      </div>}

    </div>
  </div></main>;
}
