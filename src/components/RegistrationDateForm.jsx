import { useEffect, useRef, useState } from 'react';
import { Input } from './PosUI';

const dateValue = value => {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
};

export default function RegistrationDateForm({ createdAt, onSave, disabled }) {
  const [date, setDate] = useState(() => dateValue(createdAt));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const submitting = useRef(false);
  useEffect(() => { setDate(dateValue(createdAt)); }, [createdAt]);
  return <form className="registration-date-form" onSubmit={async event => {
    event.preventDefault();
    if (disabled || submitting.current || !date) return;
    submitting.current = true; setBusy(true); setStatus('');
    try { const saved = await onSave(date); setStatus(saved === false ? '등록일을 수정하지 못했습니다.' : '등록일을 수정했습니다.'); }
    catch (error) { setStatus(error.message || '등록일 수정에 실패했습니다.'); }
    finally { submitting.current = false; setBusy(false); }
  }}><fieldset disabled={disabled || busy}><legend>상품 등록 일자</legend><div className="registration-date-controls"><label className="management-field"><span>등록일</span><Input type="date" required min="0001-01-01" max="9999-12-31" value={date} onChange={value => { setDate(value); setStatus(''); }} /></label><button className="management-back" type="submit">{busy ? '저장 중…' : '등록일 저장'}</button></div></fieldset><p role="status" className="management-note">{status}</p></form>;
}
