import StockManagementSettings from '../components/StockManagementSettings';
import LoadingState from '../components/LoadingState';
import { useEffect, useRef, useState } from 'react';
import { Input } from '../components/PosUI';
import { confirmAction } from '../utils/confirmAction';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';

const AVATAR_SIZE = 40;
// Square-crops to 40px (shown at 20px in the header, 2x for sharp screens).
async function avatarFromFile(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="app-confirm-dialog account-dialog" aria-labelledby="account-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="account-dialog-title">{title}</h2>{children}
  </dialog>;
}

export default function AccountPage({ adminId, request, logout, beforeDelete, onProfileImage }) {
  const [account, setAccount] = useState(null);
  const [nickname, setNickname] = useState('');
  const [dialog, setDialog] = useState(null);
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const clearUnsaved = useUnsavedChanges(Boolean(account && nickname !== (account.nickname || account.id)));
  useEffect(() => { let active = true; request('/api/pos?account=true').then(data => { if (!data.admin) throw new Error('마이페이지 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'); if (active) { setAccount(data.admin); setEmail(data.admin.email || ''); setNickname(data.admin.nickname || data.admin.id); } }).catch(err => { if (active) setError(err.message); }); return () => { active = false; }; }, []);
  const saveProfile = async (extra = {}) => {
    const data = await request('/api/pos', { method: 'POST', body: JSON.stringify({ action: 'updateProfile', payload: { nickname, ...extra } }) });
    setAccount(data.admin); setNickname(data.admin.nickname); onProfileImage?.(data.admin.avatar || '');
  };
  const run = async (task, setter = setError) => { if (busy) return false; setBusy(true); setter(''); try { await task(); return true; } catch (err) { if (err.message) setter(err.message); return false; } finally { setBusy(false); } };
  const save = async event => { event.preventDefault(); if (await run(() => saveProfile())) clearUnsaved(); };
  const chooseImage = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setError('PNG, JPG, WebP 이미지만 사용할 수 있습니다.'); return; }
    await run(async () => saveProfile({ avatar: await avatarFromFile(file) }));
  };
  const closeDialog = () => { if (busy) return; setDialog(null); setDialogError(''); setCurrentPassword(''); setNewPassword(''); setPasswordConfirm(''); setPassword(''); setEmail(account?.email || ''); };
  const credentials = async event => {
    event.preventDefault();
    if (newPassword !== passwordConfirm) { setDialogError('새 비밀번호 확인이 일치하지 않습니다.'); return; }
    const ok = await run(async () => { const data = await request('/api/pos', { method: 'POST', body: JSON.stringify({ action: 'updateCredentials', payload: { email, password: currentPassword, newPassword } }) }); setAccount(current => ({ ...current, ...data.admin })); }, setDialogError);
    if (ok) closeDialog();
  };
  const remove = async event => {
    event.preventDefault();
    await run(async () => {
      if (!await confirmAction('이 계정의 모든 행사, 상품·재고, 판매·정산 내역이 삭제되며 복구할 수 없습니다. 회원 탈퇴할까요?', { title: '회원 탈퇴', confirmLabel: '회원 탈퇴' })) throw new Error('');
      await beforeDelete();
      await request('/api/pos', { method: 'POST', body: JSON.stringify({ action: 'deleteAccount', payload: { password, confirmId: adminId } }) });
      clearUnsaved(); await logout();
    }, setDialogError);
  };
  return <main className="page-content inventory-page account-page"><h1 className="sr-only">마이페이지</h1><section className="product-management account-content">
    {error && <p role="alert" className="inventory-error">{error}</p>}
    {!account && !error && <LoadingState />}
    <article className="management-product account-profile-card"><div className="management-product-header"><h2>계정 정보</h2><button type="button" className="management-back" disabled={busy} onClick={logout}>로그아웃</button></div>
      <div className="account-card-body">
        <div className="account-avatar-row">
          <span className="account-avatar" aria-hidden="true">{account?.avatar ? <img src={account.avatar} alt="" width="40" height="40" /> : null}</span>
          <div className="account-avatar-actions"><label className="management-back account-avatar-upload">프로필 이미지 변경<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !account} onChange={chooseImage} /></label>{account?.avatar && <button type="button" className="management-back" disabled={busy} onClick={() => run(() => saveProfile({ avatar: '' }))}>삭제</button>}</div>
        </div>
        <dl className="management-fields account-details"><div className="management-field"><dt>아이디</dt><dd>{adminId}</dd></div>{account && <div className="management-field"><dt>이메일</dt><dd>{account.email || '미등록'}</dd></div>}</dl>
        {account && <form onSubmit={save} className="account-form account-profile-form"><label className="management-field"><span>닉네임</span><Input required maxLength={30} value={nickname} onChange={setNickname} disabled={busy} /></label><button className="management-add" disabled={busy}>닉네임 저장</button></form>}
        {account && <div className="account-actions"><button type="button" className="management-back" disabled={busy} onClick={() => setDialog('credentials')}>비밀번호 변경</button><button type="button" className="management-delete" disabled={busy} onClick={() => setDialog('delete')}>회원 탈퇴</button></div>}
      </div></article>
    <StockManagementSettings request={request} />
    {dialog === 'credentials' && <Modal title="이메일·비밀번호 변경" onClose={closeDialog}><form onSubmit={credentials} className="account-form"><label>이메일<Input type="email" required value={email} onChange={setEmail} disabled={busy} /></label><label>현재 비밀번호<Input type="password" autoComplete="current-password" required value={currentPassword} onChange={setCurrentPassword} disabled={busy} /></label><label>새 비밀번호<Input type="password" autoComplete="new-password" minLength={6} maxLength={128} value={newPassword} onChange={setNewPassword} disabled={busy} /></label><label>새 비밀번호 확인<Input type="password" autoComplete="new-password" value={passwordConfirm} onChange={setPasswordConfirm} disabled={busy} /></label>{dialogError && <p role="alert" className="inventory-error">{dialogError}</p>}<div className="app-confirm-actions"><button type="button" className="management-back" disabled={busy} onClick={closeDialog}>취소</button><button className="management-add" disabled={busy}>변경 저장</button></div></form></Modal>}
    {dialog === 'delete' && <Modal title="회원 탈퇴" onClose={closeDialog}><form onSubmit={remove} className="account-form"><p>모든 행사, 상품·재고, 판매·정산 기록이 삭제되며 복구할 수 없습니다. 모든 기기의 주문을 먼저 동기화해주세요. 계속하려면 비밀번호를 입력해주세요.</p><label>비밀번호<Input type="password" autoComplete="current-password" required value={password} onChange={setPassword} disabled={busy} /></label>{dialogError && <p role="alert" className="inventory-error">{dialogError}</p>}<div className="app-confirm-actions"><button type="button" className="management-back" disabled={busy} onClick={closeDialog}>취소</button><button className="management-delete" disabled={busy || !password}>회원 탈퇴</button></div></form></Modal>}
  </section></main>;
}
