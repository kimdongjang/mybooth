import { useState } from 'react';
import { Input } from '../components/PosUI';
import { PageIntro, PageTabs } from '../components/PageLayout';

export default function ProjectsPage({ projects, selectedProject, newProjectName, setNewProjectName, onCreateProject, onSelectProject }) {
  const [tab, setTab] = useState('list');
  return <main className="page-content projects-page">
    <div className="page-body">
      <PageIntro title="프로젝트 변경" description="행사를 선택하거나 새 프로젝트를 만들어 상품과 판매 내역을 관리하세요.">
        <PageTabs id="projects" label="프로젝트" tabs={[["list", "프로젝트 목록"], ["new", "새 프로젝트"]]} selected={tab} onSelect={setTab} />
      </PageIntro>
      <div id={`projects-panel-${tab}`} role="tabpanel" aria-labelledby={`projects-tab-${tab}`} tabIndex={0}>
      {tab === 'new' && <form onSubmit={onCreateProject} className="mb-5 rounded-xl border border-line bg-white p-4 shadow-[0_2px_0_#e2e8f0]">
        <label htmlFor="new-project-name" className="block text-sm font-bold">새 프로젝트 만들기</label>
        <div className="mt-2 flex gap-2"><Input id="new-project-name" required value={newProjectName} onChange={setNewProjectName} placeholder="예: 8월 행사, 10월 행사" /><button className="shrink-0 rounded-md bg-register px-4 py-2 text-sm font-bold text-white">생성</button></div>
      </form>}
      {tab === 'list' && <div className="grid gap-3 md:grid-cols-2">
        {projects.map((project) => <button key={project.id} onClick={() => onSelectProject(project)} aria-pressed={selectedProject?.id === project.id} className="project-card rounded-xl border border-line bg-white p-4 text-left shadow-[0_2px_0_#e2e8f0] hover:border-amber-pos">
          <div className="text-lg font-bold text-register">{project.name}</div>{selectedProject?.id === project.id && <span className="text-xs text-register">현재 프로젝트</span>}
          <div className="mt-2 text-xs text-[#64748b]">생성: {new Date(project.createdAt).toLocaleDateString('ko-KR')} · 최근 수정: {new Date(project.updatedAt).toLocaleString('ko-KR')}</div>
        </button>)}
      </div>}
      {tab === 'list' && !projects.length && <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-[#64748b]">아직 프로젝트가 없습니다. 예: “8월 행사” 프로젝트를 만들어 시작하세요.</div>}
      </div>
    </div>
  </main>;
}
