import { useState,useRef } from 'react';
import { PageIntro } from '../components/PageLayout';
import { Input } from '../components/PosUI';
import { EventLink } from '../components/ProjectNavigation';

export default function ProjectRestorePage({ booths=[], navigate, onManageProject, onSelectProject }) {
  const managedBooths=booths.filter(b=>['owner','manager'].includes(b.role));
  const [boothId,setBoothId]=useState(managedBooths[0]?.id||'');
  const pending=useRef(null);
  const [backup, setBackup] = useState(null);
  const [filename, setFilename] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createdProject, setCreatedProject] = useState(null);
  const readBackup = async event => {
    const file = event.target.files?.[0];
    setBackup(null); setFilename(''); setError(''); setPassword('');
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError('백업 파일은 3MiB 이하여야 합니다.'); return; }
    setReading(true);
    try {
      const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (data.format !== 'my-booth-project' || ![1,2].includes(data.version) || typeof data.project?.name !== 'string' || !['products', 'bundles', 'sales'].every(key => Array.isArray(data[key]))) throw new Error('행사 백업 v1/v2 JSON 파일을 선택해주세요. 주문 큐 백업은 복원할 수 없습니다.');
      setBackup(data); setFilename(file.name); setName(`${data.project.name} 복원`.slice(0, 100));
    } catch { setError('올바른 행사 백업 v1/v2 JSON 파일을 선택해주세요. 주문 큐 백업은 복원할 수 없습니다.'); }
    finally { setReading(false); }
  };
  const submit = async event => {
    event.preventDefault();
    if (busy || reading || !backup || !password || !name.trim()) return;
    setBusy(true); setError('');
    try {
      pending.current||={name,password,backup,boothId,requestId:crypto.randomUUID()};
      const result = await onManageProject(null, 'restoreProject', pending.current);
      pending.current=null;
      setPassword(''); setBackup(null); setCreatedProject(result.project);
    } catch (err) { setError(err.message);if(err.status>=400&&err.status<500)pending.current=null; }
    finally { setBusy(false); }
  };
  return <main className="page-content event-management-page"><div className="event-workspace event-workspace-standalone">
    <div className="event-main">
      <PageIntro title="백업 파일에서 새 행사로 복원" />
      {createdProject ? <section className="event-panel event-restore-success" role="status"><span className="event-status" data-archived="true">보관 상태로 복원 완료</span><h2>{createdProject.name}</h2><p>복원된 자료를 확인한 후 행사 관리에서 비밀번호로 보관을 해제하면 판매를 시작할 수 있습니다.</p><button className="event-button event-button-primary" onClick={() => onSelectProject(createdProject)}>복원한 행사 열기 →</button><EventLink page="projects" navigate={navigate} className="event-text-link">행사 목록으로</EventLink></section> : <form onSubmit={submit}><fieldset disabled={busy || reading} className="event-form-fields">
        <section className="event-panel"><span className="event-step">1 · 백업 파일 선택</span><h2>복원할 자료 확인</h2><p>행사 백업에서 다운로드한 JSON을 선택하세요. 최대 3MiB이며 이미지 파일과 미동기화 주문은 포함하지 않습니다.</p>
          <label className="event-upload">행사 백업 파일<input aria-label="행사 백업 파일" type="file" accept=".json,application/json" onChange={readBackup} /><span className="event-muted">{filename || '행사 백업 v1/v2 · JSON · 최대 3MiB'}</span></label>
          {backup && <div className="event-file-preview"><strong>{backup.project.name}</strong><dl className="event-metrics"><div><dt>상품</dt><dd>{backup.products.length}개</dd></div><div><dt>세트</dt><dd>{backup.bundles.length}개</dd></div><div><dt>판매</dt><dd>{backup.sales.length}건</dd></div><div><dt>총 판매액</dt><dd>{backup.sales.reduce((sum,row)=>sum+Number(row.total||0),0).toLocaleString()}원</dd></div><div><dt>정산</dt><dd>{backup.closure?.closed_at?'마감':'정산 중'}</dd></div></dl></div>}
        </section>
        <section className="event-panel"><span className="event-step">2 · 새 행사 정보</span>{managedBooths.length>1&&<label className="event-field">운영 부스<select required value={boothId} onChange={e=>setBoothId(e.target.value)}>{managedBooths.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}<h2>보관 상태로 복원</h2><label className="event-field">복원할 새 행사 이름<Input maxLength={100} required value={name} onChange={setName} /></label><div className="event-callout"><p>기존 행사는 덮어쓰지 않습니다. 제작자는 새 미연결 프로필로 가져오고 재고는 기존 상품과 분리합니다. 복원된 행사는 판매 종료 상태로 시작합니다.</p></div></section>
        <section className="event-panel"><span className="event-step">3 · 비밀번호 확인</span><label className="event-field">계정 비밀번호<Input type="password" autoComplete="current-password" required value={password} onChange={setPassword} /></label><div className="event-form-actions"><button disabled={!backup || !name.trim() || !password || busy || reading} className="event-button event-button-primary">{busy ? '복원 중…' : '새 행사로 복원'}</button><EventLink page="projects" navigate={navigate} className="event-text-link">행사 선택으로 돌아가기</EventLink></div></section>
      </fieldset></form>}
      {error && <p role="alert" className="event-error">{error}</p>}
      {(busy || reading) && <p role="status" className="event-muted">{reading ? '백업 파일 확인 중…' : '복원 처리 중…'}</p>}
    </div>
  </div></main>;
}
