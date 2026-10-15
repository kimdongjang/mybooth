import { useState } from 'react';
import { PageIntro } from '../components/PageLayout';
import { Input } from '../components/PosUI';
import ProjectNavigation, { EventLink, projectSections } from '../components/ProjectNavigation';
import { won } from '../utils/productDisplay';

export default function ProjectManagementPage({ page, project, summary, navigate, onManageProject, onSelectProject }) {
  const [name, setName] = useState(page === 'projectDuplicate' ? `${project.name} 복사`.slice(0, 100) : project.name);
  const [password, setPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createdProject, setCreatedProject] = useState(null);
  const archived = Boolean(project.archivedAt);
  const item = projectSections.find(section => section.page === page);
  const action = { projectName: 'renameProject', projectArchive: archived ? 'unarchiveProject' : 'archiveProject', projectDuplicate: 'duplicateProject', projectBackup: 'backupProject', projectDelete: 'deleteProject' }[page];
  const actionLabel = { renameProject: '이름 변경', archiveProject: '행사 종료·보관', unarchiveProject: '보관 해제하고 판매 재개', duplicateProject: '새 행사로 복제', backupProject: '프로젝트 백업 다운로드', deleteProject: '행사 영구 삭제' }[action];
  const descriptions = {
    projectName: '다른 행사와 구분하기 쉬운 이름을 입력하세요.',
    projectArchive: archived ? '기록을 확인한 뒤 판매와 수정을 다시 시작할 수 있습니다.' : '판매를 마친 행사를 읽기 전용으로 보관합니다.',
    projectDuplicate: '원본 행사는 유지하고 새 행사를 만듭니다.',
    projectBackup: '서버에 저장된 행사 자료를 JSON 파일로 보관하세요.',
    projectDelete: '삭제한 자료는 되돌릴 수 없습니다. 먼저 백업을 다운로드하세요.',
  };
  const submit = async event => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true); setError(''); setNotice(''); setCreatedProject(null);
    try {
      const result = await onManageProject(project, action, { name, confirmName, password });
      setPassword('');
      if (result?.project) setCreatedProject(result.project);
      setNotice(action === 'backupProject' ? '프로젝트 백업 파일을 다운로드했습니다.' : action === 'archiveProject' ? '행사를 종료하고 보관했습니다.' : action === 'unarchiveProject' ? '보관을 해제했습니다. 판매를 다시 시작할 수 있습니다.' : `${actionLabel} 완료`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <main className="page-content event-management-page"><div className="event-workspace">
    <ProjectNavigation page={page} project={project} navigate={navigate} />
    <div className="event-main">
      <PageIntro title={page === 'project' ? '행사 관리' : item.title} description={page === 'project' ? '현재 행사에 필요한 관리 작업을 선택하세요.' : descriptions[page]} />
      {notice && <div role="status" className="event-feedback"><p>{notice}</p>{createdProject && <button type="button" className="event-button" onClick={() => onSelectProject(createdProject)}>복제한 행사 열기 →</button>}</div>}
      {page === 'project' ? <>
        <section className="event-panel event-overview"><div><span className="event-status" data-archived={archived}>{archived ? '보관 중' : '진행 중'}</span><h2>{project.name}</h2><p>이 화면의 작업은 위 행사에만 적용됩니다.</p></div><dl className="event-metrics"><div><dt>상품</dt><dd>{summary.products}개</dd></div><div><dt>세트</dt><dd>{summary.bundles}개</dd></div><div><dt>거래</dt><dd>{summary.sales}건</dd></div><div><dt>총 판매액</dt><dd>{won(summary.total)}원</dd></div></dl></section>
        <div className="event-action-grid">{projectSections.slice(1).map(section => <EventLink key={section.page} page={section.page} navigate={navigate} className={`event-action-card ${section.danger ? 'is-danger' : ''}`}><span className="event-card-title">{section.title}<span aria-hidden="true">→</span></span><p>{section.description}</p></EventLink>)}</div>
      </> : <>
        {page === 'projectBackup' && <div className="event-backup-options"><section className="event-panel"><span className="event-step">01 · 파일로 보관</span><h2>프로젝트 백업</h2><p>아래에서 비밀번호 확인 후 현재 행사의 백업 파일을 다운로드하세요.</p></section><section className="event-panel"><span className="event-step">02 · 파일에서 가져오기</span><h2>백업 복원</h2><p>기존 행사를 덮어쓰지 않고 새 행사를 보관 상태로 만듭니다.</p><EventLink page="restore" navigate={navigate} className="event-button">백업 파일 복원하기 →</EventLink></section></div>}
        <section className={`event-panel event-operation ${page === 'projectDelete' ? 'event-danger-panel' : ''}`} aria-label={item.title}>
          <div className="event-operation-heading"><span className="event-muted">적용할 행사</span><strong>{project.name}</strong></div>
          {page === 'projectName' && archived ? <div className="event-callout"><p>보관 중인 행사는 이름을 변경할 수 없습니다. 보관을 해제한 뒤 변경해주세요.</p><EventLink page="projectArchive" navigate={navigate} className="event-button">보관 해제 화면으로 →</EventLink></div> : <form onSubmit={submit}><fieldset disabled={busy} className="event-form-fields">
            {['projectName', 'projectDuplicate'].includes(page) && <label className="event-field">{page === 'projectDuplicate' ? '새 행사 이름' : '행사 이름'}<Input aria-label={page === 'projectDuplicate' ? '새 행사 이름' : '행사 이름'} aria-describedby="event-name-help" value={name} onChange={setName} maxLength={100} required /><span id="event-name-help" className="event-muted">1~100자로 입력해주세요.</span></label>}
            {page === 'projectArchive' && <div className="event-callout"><h2>{archived ? '판매를 다시 시작합니다' : '판매를 마치고 기록을 보관합니다'}</h2><p>{archived ? '상품·재고·판매 기록을 유지한 채 판매·취소·수정을 다시 허용합니다. 다른 기기의 대기 주문이 다시 전송될 수 있으므로 먼저 확인해주세요.' : '판매·취소·상품·세트 수정을 잠급니다. 정산 조회와 백업은 계속 사용할 수 있고, 비밀번호로 보관을 해제할 수 있습니다.'}</p></div>}
            {page === 'projectDuplicate' && <div className="event-transfer-summary"><div><h3>복사하는 자료</h3><p>상품·세트 구성, 가격, 제작자, 이미지 URL</p></div><div><h3>새로 시작하는 자료</h3><p>등록·남은 재고 0개, 판매 내역 0건. 새 행사에서 입고 수량을 등록해주세요.</p></div></div>}
            {page === 'projectBackup' && <div className="event-transfer-summary"><div><h3>백업에 포함</h3><p>서버 상품·세트·재고·판매 내역, 이미지 URL</p></div><div><h3>별도 보관 필요</h3><p>이미지 파일 자체와 미동기화 주문은 제외합니다. 프로젝트 JSON은 최대 3MiB입니다.</p></div></div>}
            {page === 'projectDelete' && <><div className="event-callout is-danger"><h2>이 행사를 영구 삭제합니다</h2><p>상품·세트·재고·판매 기록과 이 기기의 상태 캐시를 삭제합니다. 로컬 주문 백업·업로드 이미지·기존 서버 보관 원본은 유지됩니다.</p><EventLink page="projectBackup" navigate={navigate} className="event-text-link">삭제 전 백업 다운로드 →</EventLink></div><label className="event-field">삭제할 행사 이름을 그대로 입력<Input aria-label="삭제할 행사 이름을 그대로 입력" aria-describedby="event-delete-help" required value={confirmName} onChange={setConfirmName} /><span id="event-delete-help" className="event-muted">확인할 이름: {project.name}</span></label></>}
            {['projectArchive', 'projectDuplicate', 'projectBackup', 'projectDelete'].includes(page) && !(page === 'projectArchive' && archived) && <p className="event-queue-note">모든 기기·탭에서 판매를 중단하고 동기화를 완료해주세요. 이 기기에 미동기화 주문이 있으면 실행할 수 없습니다. 서버는 다른 기기의 대기 주문을 확인할 수 없습니다.</p>}
            <div className="event-confirmation"><label className="event-field">계정 비밀번호<Input type="password" autoComplete="current-password" required value={password} onChange={setPassword} /></label><span className="event-muted">이 작업을 실행할 때마다 비밀번호를 확인합니다.</span></div>
            <div className="event-form-actions"><button disabled={busy || !password || (['projectName', 'projectDuplicate'].includes(page) && !name.trim()) || (page === 'projectDelete' && confirmName !== project.name)} className={`event-button ${page === 'projectDelete' ? 'event-button-danger' : 'event-button-primary'}`}>{busy ? '처리 중…' : actionLabel}</button><EventLink page="project" navigate={navigate} className="event-text-link">행사 개요로</EventLink></div>
          </fieldset></form>}
          {error && <p role="alert" className="event-error">{error}</p>}
          {busy && <p role="status" className="event-muted">작업을 처리하고 있습니다.</p>}
        </section>
      </>}
    </div>
  </div></main>;
}
