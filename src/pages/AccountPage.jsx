import StockManagementSettings from '../components/StockManagementSettings';
import AccountBackup from '../components/AccountBackup';
import ArtistAccount from '../components/ArtistAccount';
import ContractRetirement from '../components/ContractRetirement';
import LoadingState from '../components/LoadingState';
import { useEffect, useState } from 'react';
import { Input } from '../components/PosUI';
import { confirmAction } from '../utils/confirmAction';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
export default function AccountPage({ adminId, request, logout, beforeDelete }) {
  const [account, setAccount] = useState(null);
  const [artistCompatibility,setArtistCompatibility]=useState(null);
  const compatibility={...account?.compatibility,...artistCompatibility};
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const clearUnsaved = useUnsavedChanges(Boolean(account && (nickname !== (account.nickname || account.id) || email !== (account.email || '') || currentPassword || newPassword || passwordConfirm)));
  useEffect(() => { let active = true; request('/api/pos?account=true').then(data => { if (!data.admin) throw new Error('마이페이지 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'); if (active) { setAccount({...data.admin, compatibility:data.compatibility}); setEmail(data.admin.email || ''); setNickname(data.admin.nickname || data.admin.id); } }).catch(err => { if (active) setError(err.message); }); return () => { active = false; }; }, []);
  const save = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
    try { const data = await request('/api/pos', { method: 'POST', body: JSON.stringify({ action: 'updateProfile', payload: { nickname } }) }); setAccount(current=>({...data.admin,compatibility:current?.compatibility})); setNickname(data.admin.nickname); clearUnsaved();  } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const credentials = async event => {
    event.preventDefault(); if (busy) return;
    if (newPassword !== passwordConfirm) { setError('새 비밀번호 확인이 일치하지 않습니다.'); return; }
    setBusy(true); setError('');
    try { const data = await request('/api/pos', {method:'POST',body:JSON.stringify({action:'updateCredentials',payload:{email,password:currentPassword,newPassword}})}); setAccount(current=>({...data.admin,compatibility:current?.compatibility})); setCurrentPassword(''); setNewPassword(''); setPasswordConfirm(''); } catch(err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async event => {
    event.preventDefault(); if (busy) return; setError(''); setMessage('');
    if(compatibility.deleteAllowed === false){setError('부스 이력 보존을 위해 현재 계정은 바로 탈퇴할 수 없습니다.');return;}
    if (!await confirmAction('이 계정의 모든 행사, 상품·재고, 판매·정산 내역이 삭제되며 복구할 수 없습니다. 회원 탈퇴할까요?', { title: '회원 탈퇴', confirmLabel: '회원 탈퇴' })) return;
    setBusy(true);
    try { await beforeDelete(); await request('/api/pos', { method: 'POST', body: JSON.stringify({ action: 'deleteAccount', payload: { password, confirmId } }) }); clearUnsaved(); await logout(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <main className="page-content inventory-page account-page"><header className="inventory-page-header"><nav className="inventory-breadcrumb" aria-label="현재 위치"><ol><li><a href="#/account">마이페이지</a></li><li aria-hidden="true">/</li><li><h1 aria-current="page">계정 정보</h1></li></ol></nav></header><section className="product-management account-content">
    {error && <p role="alert" className="inventory-error">{error}</p>}{message && <p role="status">{message}</p>}
    {!account && !error && <LoadingState />}
    <article className="management-product"><div className="management-product-header"><h2>계정 정보</h2><button type="button" className="management-back" disabled={busy} onClick={logout}>로그아웃</button></div><div className="account-card-body"><dl className="management-fields account-details"><div className="management-field"><dt>아이디</dt><dd>{adminId}</dd></div>{account && <div className="management-field"><dt>이메일</dt><dd>{account.email || '미등록'}</dd></div>}</dl>{account && <form onSubmit={save} className="account-form"><label className="management-field"><span>닉네임</span><Input required maxLength={30} value={nickname} onChange={setNickname} disabled={busy} /></label><button className="management-add" disabled={busy}>닉네임 저장</button></form>}
    </div></article>
    {account && <section className="management-product"><div className="management-product-header"><h2>이메일·비밀번호 변경</h2></div><form onSubmit={credentials} className="account-card-body account-form"><label>이메일<Input type="email" required value={email} onChange={setEmail} disabled={busy}/></label><label>현재 비밀번호<Input type="password" autoComplete="current-password" required value={currentPassword} onChange={setCurrentPassword} disabled={busy}/></label><label>새 비밀번호<Input type="password" autoComplete="new-password" minLength={6} maxLength={128} value={newPassword} onChange={setNewPassword} disabled={busy}/></label><label>새 비밀번호 확인<Input type="password" autoComplete="new-password" value={passwordConfirm} onChange={setPasswordConfirm} disabled={busy}/></label><button className="management-add" disabled={busy}>변경 저장</button></form></section>}
    <StockManagementSettings request={request}/>
    <ArtistAccount mode="profile" key={adminId} request={request} onCompatibility={setArtistCompatibility} />


    <section className="management-product account-danger"><div className="management-product-header"><h2>회원 탈퇴</h2></div><div className="account-card-body"><p>모든 행사, 상품·재고, 판매·정산 기록을 삭제합니다. 이미지 파일과 이 기기의 로컬 주문 기록은 삭제하지 않습니다. 탈퇴한 아이디는 다시 사용할 수 없습니다. 모든 기기의 주문을 먼저 동기화해주세요.</p><form onSubmit={remove} className="account-form"><label className="management-field"><span>아이디 확인</span><Input required value={confirmId} onChange={setConfirmId} disabled={busy} /></label><label className="management-field"><span>현재 패스워드</span><Input type="password" autoComplete="current-password" required value={password} onChange={setPassword} disabled={busy} /></label><button className="management-delete" disabled={busy || !account}>회원 탈퇴</button></form></div></section>
  </section></main>;
}
