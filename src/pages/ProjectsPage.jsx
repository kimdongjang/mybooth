import { useEffect, useRef, useState } from 'react';
import { Input } from '../components/PosUI';
import { PageIntro, PageTabs } from '../components/PageLayout';

const button = 'rounded-md border border-line px-4 py-2 font-bold disabled:opacity-50';
const actions = { renameProject: '이름 변경', archiveProject: '행사 종료·보관', unarchiveProject: '보관 해제', duplicateProject: '프로젝트 복제', backupProject: '프로젝트 백업 다운로드', deleteProject: '프로젝트 영구 삭제', restoreProject: '새 프로젝트로 복원' };

export default function ProjectsPage({ projects, selectedProject, newProjectName, setNewProjectName, onCreateProject, onSelectProject, onManageProject }) {
  const [tab, setTab] = useState('list');
  const [editingId, setEditingId] = useState(null);
  const editing = projects.find(project => project.id === editingId);
  const [action, setAction] = useState('renameProject');
  const [name, setName] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [backup, setBackup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const heading = useRef(null);
  const fileVersion = useRef(0);
  useEffect(() => { if (editingId) heading.current?.focus(); }, [editingId]);
  const reset = () => { setPassword(''); setError(''); setNotice(''); setConfirmName(''); };
  const chooseAction = value => {
    setAction(value); reset(); setName(value === 'duplicateProject' ? `${editing.name} 복사`.slice(0, 100) : editing.name);
  };
  const open = project => {
    setEditingId(project.id); setAction(project.archivedAt ? 'backupProject' : 'renameProject'); setName(project.name); reset();
  };
  const changeTab = value => {
    if (busy || reading) return;
    fileVersion.current += 1;
    setTab(value); setEditingId(null); setBackup(null); reset();
  };
  const readBackup = async event => {
    const file = event.target.files?.[0];
    const version = ++fileVersion.current;
    setBackup(null); setError(''); setNotice('');
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError('백업 파일은 3MiB 이하여야 합니다.'); return; }
    setReading(true);
    try {
      const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (version !== fileVersion.current) return;
      if (data.format !== 'my-booth-project' || data.version !== 1 || !data.project || !['products', 'bundles', 'sales'].every(key => Array.isArray(data[key]))) throw new Error('프로젝트 백업 v1 JSON 파일을 선택해주세요. 주문 큐 백업은 복원할 수 없습니다.');
      setBackup(data); setName(`${data.project.name} 복원`.slice(0, 100));
    } catch (err) { if (version === fileVersion.current) setError(err.message); }
    finally { if (version === fileVersion.current) setReading(false); }
  };
  const submit = async event => {
    event.preventDefault();
    if (busy || !password) return;
    const operation = tab === 'restore' ? 'restoreProject' : action;
    setBusy(true); setError(''); setNotice('');
    try {
      await onManageProject(operation === 'restoreProject' ? null : editing, operation, { name, confirmName, password, ...(operation === 'restoreProject' ? { backup } : {}) });
      setPassword(''); setEditingId(null);
      if (operation === 'restoreProject') { setBackup(null); setTab('list'); }
      setNotice(operation === 'backupProject' ? '서버에 저장된 프로젝트 백업을 다운로드했습니다.' : `${actions[operation]} 완료`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const passwordField = <label className="mt-4 block font-bold">계정 비밀번호<Input type="password" autoComplete="current-password" required value={password} onChange={setPassword} /></label>;
  return <main className="page-content projects-page"><div className="page-body">
    <PageIntro title="프로젝트 관리" description="행사를 선택하고 보관·복제·백업을 관리하세요.">
      <PageTabs id="projects" label="프로젝트" tabs={[["list", "프로젝트 목록"], ["new", "새 프로젝트"], ["restore", "백업 복원"]]} selected={tab} onSelect={changeTab} />
    </PageIntro>
    {notice && <p role="status" className="mb-4 rounded border border-line bg-white p-3">{notice}</p>}
    <div id={`projects-panel-${tab}`} role="tabpanel" aria-labelledby={`projects-tab-${tab}`} tabIndex={0}>
      {tab === 'new' && <form onSubmit={onCreateProject} className="rounded-xl border border-line bg-white p-4">
        <label htmlFor="new-project-name" className="block font-bold">새 프로젝트 이름</label>
        <Input id="new-project-name" required maxLength={100} value={newProjectName} onChange={setNewProjectName} placeholder="예: 10월 행사" />
        <button className={`${button} mt-3 bg-register text-white`}>생성</button>
      </form>}
      {tab === 'list' && <>
        <div className="project-grid grid gap-3 md:grid-cols-2">
          {projects.map(project => <article key={project.id} className="project-card min-w-0 rounded-xl border border-line bg-white p-4">
            <button disabled={busy} onClick={() => onSelectProject(project)} aria-pressed={selectedProject?.id === project.id} className="w-full break-words text-left">
              <div className="text-lg font-bold text-register">{project.name}</div>
              <div className="mt-1 text-sm">{project.archivedAt ? '보관 · 읽기 전용' : '진행 중'}{selectedProject?.id === project.id ? ' · 현재 프로젝트' : ''}</div>
              <div className="mt-2 text-xs text-slate-500">생성: {new Date(project.createdAt).toLocaleDateString('ko-KR')} · 최근 수정: {new Date(project.updatedAt).toLocaleString('ko-KR')}</div>
            </button>
            <button type="button" disabled={busy} onClick={() => open(project)} aria-label={`${project.name} 관리`} className={`${button} mt-3`}>프로젝트 관리</button>
          </article>)}
        </div>
        {!projects.length && <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center">아직 프로젝트가 없습니다. 새 프로젝트를 만들어 시작하세요.</p>}
        {editing && <section aria-label="프로젝트 관리" className="mt-5 min-w-0 rounded-xl border border-line bg-white p-4">
          <h2 ref={heading} tabIndex={-1} className="break-words text-lg font-bold">{editing.name} 관리</h2>
          <form onSubmit={submit}><fieldset disabled={busy} className="min-w-0">
            <label className="mt-3 block font-bold">관리 작업<select value={action} onChange={event => chooseAction(event.target.value)} className="mt-1 block w-full rounded border border-line p-2">
              {!editing.archivedAt && <option value="renameProject">이름 변경</option>}
              <option value={editing.archivedAt ? 'unarchiveProject' : 'archiveProject'}>{editing.archivedAt ? '보관 해제' : '행사 종료·보관'}</option>
              <option value="duplicateProject">프로젝트 복제</option><option value="backupProject">프로젝트 백업 다운로드</option><option value="deleteProject">프로젝트 영구 삭제</option>
            </select></label>
            {['renameProject', 'duplicateProject'].includes(action) && <label className="mt-3 block font-bold">{action === 'duplicateProject' ? '새 프로젝트 이름' : '프로젝트 이름'}<Input required maxLength={100} value={name} onChange={setName} /></label>}
            {action === 'archiveProject' && <p className="mt-3">행사를 종료하고 판매·취소·상품·세트 수정을 잠급니다. 정산 기록은 유지되며, 비밀번호로 보관을 해제할 수 있습니다.</p>}
            {action === 'unarchiveProject' && <p className="mt-3">보관을 해제하고 판매·수정을 재개합니다. 다른 기기의 대기 주문도 다시 전송될 수 있으므로 먼저 확인해주세요.</p>}
            {action === 'duplicateProject' && <p className="mt-3">상품·세트 구성과 가격·이미지 URL을 복사합니다. 판매 내역은 제외하며 등록·남은 재고는 모두 0으로 시작합니다. 새 행사에 맞게 입고 수량을 등록해주세요.</p>}
            {action === 'backupProject' && <p className="mt-3">서버의 상품·세트·재고·판매 전체를 JSON으로 다운로드합니다. 미동기화 주문과 이미지 파일 자체는 포함하지 않습니다. 이미지는 기존 공개 URL을 참조합니다.</p>}
            {action === 'deleteProject' && <><p className="mt-3 text-red-700">상품·세트·재고·판매 기록과 이 기기의 상태 캐시를 영구 삭제합니다. 복구하려면 먼저 프로젝트 백업을 다운로드해주세요. 로컬 주문 백업·업로드 이미지·기존 서버 보관 원본은 유지됩니다.</p><label className="mt-3 block font-bold">삭제할 프로젝트 이름을 그대로 입력<Input required value={confirmName} onChange={setConfirmName} /></label></>}
            {['archiveProject', 'deleteProject', 'duplicateProject', 'backupProject'].includes(action) && <p className="mt-3 text-sm text-slate-600">이 기기에 미동기화 주문이 있으면 실행할 수 없습니다. 다른 기기·탭에서도 판매를 중단하고 동기화를 완료해주세요. 서버는 다른 기기의 대기 주문을 확인할 수 없습니다.</p>}
            {passwordField}
            <button disabled={busy || !password || (['renameProject', 'duplicateProject'].includes(action) && !name.trim()) || (action === 'deleteProject' && confirmName !== editing.name)} className={`${button} mt-4 ${action === 'deleteProject' ? 'bg-red-700' : 'bg-register'} text-white`}>{actions[action]}</button>
          </fieldset></form>
          <button type="button" disabled={busy} onClick={() => { setEditingId(null); reset(); }} className={`${button} mt-3`}>닫기</button>
        </section>}
      </>}
      {tab === 'restore' && <form onSubmit={submit} className="min-w-0 rounded-xl border border-line bg-white p-4"><fieldset disabled={busy} className="min-w-0">
        <h2 className="text-lg font-bold">프로젝트 백업 복원</h2>
        <p className="my-3">프로젝트 백업 v1 JSON을 새 프로젝트로 복원합니다. 기존 행사는 유지하고, 복원한 행사는 보관 상태로 시작합니다. 내역을 확인한 후 비밀번호로 보관을 해제해주세요.</p>
        <label className="block font-bold">프로젝트 백업 파일 (최대 3MiB)<input type="file" accept=".json,application/json" disabled={reading} onChange={readBackup} className="mt-2 block w-full min-w-0 text-sm" /></label>
        {backup && <p className="mt-3 break-words">{backup.project.name} · 상품 {backup.products.length}개 · 세트 {backup.bundles.length}개 · 판매 {backup.sales.length}건</p>}
        <label className="mt-3 block font-bold">복원할 새 프로젝트 이름<Input required maxLength={100} value={name} onChange={setName} /></label>
        {passwordField}
        <button disabled={busy || reading || !backup || !name.trim() || !password} className={`${button} mt-4 bg-register text-white`}>새 프로젝트로 복원</button>
      </fieldset></form>}
      {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
      {(busy || reading) && <p role="status">{reading ? '백업 파일 확인 중...' : '처리 중...'}</p>}
    </div>
  </div></main>;
}
