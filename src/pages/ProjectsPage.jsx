import { useState } from 'react';
import { Input } from '../components/PosUI';
import { PageIntro, PageTabs } from '../components/PageLayout';

export default function ProjectsPage({ projects, selectedProject, newProjectName, setNewProjectName, onCreateProject, onSelectProject, onManageProject }) {
  const [tab, setTab] = useState('list');
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = project => {
    setEditing(project); setName(project.name); setConfirmName(''); setPassword(''); setError('');
  };
  const submit = async (event, action) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await onManageProject(editing, action, action === 'renameProject' ? { name } : { confirmName, password });
      setEditing(null); setPassword('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
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
      {tab === 'list' && <div className="project-grid grid gap-3 md:grid-cols-2">
        {projects.map((project) => <article key={project.id} className="project-card min-w-0 rounded-xl border border-line bg-white p-4 text-left shadow-[0_2px_0_#e2e8f0]">
          <button disabled={busy} onClick={() => onSelectProject(project)} aria-pressed={selectedProject?.id === project.id} className="w-full break-words text-left">
          <div className="text-lg font-bold text-register">{project.name}</div>{selectedProject?.id === project.id && <span className="text-xs text-register">현재 프로젝트</span>}
          <div className="mt-2 text-xs text-[#64748b]">생성: {new Date(project.createdAt).toLocaleDateString('ko-KR')} · 최근 수정: {new Date(project.updatedAt).toLocaleString('ko-KR')}</div>
          </button>
          <button type="button" disabled={busy} onClick={() => open(project)} aria-label={`${project.name} 관리`} className="mt-3 rounded-md border border-line px-4 py-2 font-bold">프로젝트 관리</button>
        </article>)}
      </div>}
      {editing && tab === 'list' && <section aria-label="프로젝트 관리" className="mt-5 min-w-0 rounded-xl border border-line bg-white p-4">
        <h2 className="break-words text-lg font-bold">{editing.name} 관리</h2>
        <form onSubmit={event => submit(event, 'renameProject')} className="mt-4">
          <label htmlFor="project-rename" className="block font-bold">프로젝트 이름</label>
          <Input id="project-rename" required maxLength={100} value={name} onChange={setName} />
          <button disabled={busy || !name.trim()} className="mt-2 rounded-md bg-register px-4 py-2 font-bold text-white">이름 변경</button>
        </form>
        <form onSubmit={event => submit(event, 'deleteProject')} className="mt-6 border-t border-line pt-4">
          <h3 className="font-bold text-red-700">프로젝트 삭제</h3>
          <p className="my-2 text-sm">이 프로젝트의 상품·세트·재고·판매 기록과 이 기기의 상태 캐시를 영구 삭제합니다. 복구할 수 없으므로 필요한 내역을 먼저 백업해주세요. 이 기기의 주문 백업과 기존 업로드 이미지·서버 보관 원본은 유지됩니다.</p>
          <p className="my-2 text-sm">이 기기에 미동기화 주문이 있으면 삭제할 수 없습니다. 다른 기기·탭에서도 판매를 중단하고 동기화를 완료해주세요. 서버는 다른 기기의 대기 주문을 확인할 수 없습니다.</p>
          <label htmlFor="project-delete-name" className="block font-bold">삭제할 프로젝트 이름을 그대로 입력</label>
          <Input id="project-delete-name" required value={confirmName} onChange={setConfirmName} />
          <label htmlFor="project-delete-password" className="mt-2 block font-bold">계정 비밀번호</label>
          <Input id="project-delete-password" type="password" autoComplete="current-password" required value={password} onChange={setPassword} />
          <button disabled={busy || confirmName !== editing.name || !password} className="mt-2 rounded-md bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">프로젝트 영구 삭제</button>
        </form>
        {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
        {busy && <p role="status">처리 중...</p>}
        <button type="button" disabled={busy} onClick={() => { setEditing(null); setPassword(''); }} className="mt-4 rounded-md border border-line px-4 py-2">닫기</button>
      </section>}
      {tab === 'list' && !projects.length && <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-[#64748b]">아직 프로젝트가 없습니다. 예: “8월 행사” 프로젝트를 만들어 시작하세요.</div>}
      </div>
    </div>
  </main>;
}
