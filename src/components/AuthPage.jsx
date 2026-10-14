import { useState } from 'react';

function PasswordField({ id, label, value, onChange, signup }) {
  const [visible, setVisible] = useState(false);
  return <div className="mb-3">
    <label htmlFor={id} className="block text-sm font-bold">{label}</label>
    <div className="mt-1 flex gap-2">
      <input id={id} name={id} type={visible ? 'text' : 'password'} required minLength={signup ? 6 : undefined} autoComplete={signup ? 'new-password' : 'current-password'} value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 rounded border border-line p-1.5 text-[13px]" />
      <button type="button" aria-controls={id} aria-pressed={visible} aria-label={`${label} ${visible ? '숨기기' : '보기'}`} onClick={() => setVisible(!visible)} className="shrink-0 rounded border border-line px-3 text-xs font-bold text-register">{visible ? '숨기기' : '보기'}</button>
    </div>
  </div>;
}

function AuthForm({ mode, onAuthenticate }) {
  const signup = mode === 'signup';
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (signup && password !== confirmation) {
      setError('패스워드와 패스워드 확인이 일치하지 않습니다.');
      return;
    }
    setSubmitting(true);
    try {
      await onAuthenticate({ mode, id, password, ...(signup ? { email } : {}) });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };
  return <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-xl shadow-blue-900/5">
    <div className="mb-5 text-center"><a href="#/login" onClick={(event) => { if (submitting) event.preventDefault(); }} className="display-font text-2xl font-bold text-register">마이 부스</a><h1 className="mt-2 text-lg font-bold">{signup ? '회원가입' : '로그인'}</h1><p className="mt-1 text-sm text-[#526078]">관리자별 행사 프로젝트를 관리합니다.</p></div>
    <fieldset disabled={submitting} className="min-w-0">
      <div className="mb-4 grid grid-cols-2 rounded-lg border border-line bg-white p-1 text-sm font-bold">
        <a href="#/login" aria-current={!signup ? 'page' : undefined} aria-disabled={submitting} onClick={(event) => { if (submitting) event.preventDefault(); }} className={`rounded-md py-2 text-center ${!signup ? 'bg-register text-white' : 'text-[#526078]'}`}>로그인</a>
        <a href="#/signup" aria-current={signup ? 'page' : undefined} aria-disabled={submitting} onClick={(event) => { if (submitting) event.preventDefault(); }} className={`rounded-md py-2 text-center ${signup ? 'bg-register text-white' : 'text-[#526078]'}`}>회원가입</a>
      </div>
      <label className="mb-3 block text-sm font-bold">아이디<input name={`${mode}-username`} autoComplete="username" required autoFocus value={id} onChange={(e) => setId(e.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-[13px]" /></label>
      {signup && <label className="mb-3 block text-sm font-bold">이메일<input type="email" name="signup-email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-[13px]" /></label>}
      <PasswordField id={`${mode}-password`} label="패스워드" signup={signup} value={password} onChange={setPassword} />
      {signup && <PasswordField id="signup-password-confirmation" label="패스워드 확인" signup value={confirmation} onChange={setConfirmation} />}
      {error && <div role="alert" className="mb-3 rounded bg-danger px-3 py-2 text-xs text-white">{error}</div>}
      <button disabled={submitting} className="w-full rounded-lg bg-register px-4 py-3 font-bold text-white disabled:opacity-60">{submitting ? '처리 중…' : signup ? '회원가입하고 시작' : '로그인'}</button>
    </fieldset>
    <p className="mt-4 text-xs leading-5 text-[#64748b]">행사별 상품과 판매 내역을 한곳에서 관리하세요.</p>
  </form>;
}

export default function AuthPage({ onAuthenticate, mode }) {
  // Remounting clears credentials, errors and password visibility on every switch.
  return <main className="flex min-h-full items-center justify-center bg-paper px-4 py-10 text-ink"><AuthForm key={mode} mode={mode} onAuthenticate={onAuthenticate} /></main>;
}
