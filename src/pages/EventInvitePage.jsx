import { useEffect, useState } from 'react';

export default function EventInvitePage({ request, code, onAccepted, onClose }) {
  const [invitation, setInvitation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const post = (action, payload) => request('/api/booths', { method: 'POST', body: JSON.stringify({ action, payload }) });
  useEffect(() => {
    let active = true;
    setInvitation(null);
    setError('');
    post('previewEventInvite', { token: code }).then(data => { if (active) setInvitation(data.invitation); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [code]);
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await post('acceptEventInvite', { token: code, acceptSharedStock: true });
      await onAccepted(result);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return <main className="page-content event-invite-page"><section className="management-product event-invite-card">
    <div className="management-product-header"><h2>행사 제작자 초대</h2></div>
    <div className="account-card-body">
      {error && <p role="alert" className="inventory-error">{error}</p>}
      {invitation && <div className="account-form event-invite-body">
        <dl className="account-details">
          <div><dt>행사</dt><dd>{invitation.eventName}</dd></div>
          {invitation.operatorName && <div><dt>운영자</dt><dd>{invitation.operatorName}{invitation.operatorOthers > 0 && ` 외 ${invitation.operatorOthers}명`}</dd></div>}
          {invitation.boothName && <div><dt>부스</dt><dd>{invitation.boothName}</dd></div>}
          {invitation.startsOn && <div><dt>행사 날짜</dt><dd>{invitation.startsOn === invitation.endsOn ? invitation.startsOn : `${invitation.startsOn} ~ ${invitation.endsOn}`}</dd></div>}
          {invitation.venue && <div><dt>행사 위치</dt><dd>{invitation.venue}</dd></div>}
          <div><dt>초대 만료</dt><dd>{new Date(invitation.expiresAt).toLocaleString('ko-KR')}</dd></div>
        </dl>
        {invitation.joined
          ? <button type="button" className="management-add" onClick={() => onAccepted({ joined: true })}>행사로 이동</button>
          : <>
            <button type="button" className="management-add" disabled={busy} onClick={accept}>수락하고 제작자로 참여</button>
          </>}
      </div>}
      <button type="button" className="management-back event-invite-close" disabled={busy} onClick={onClose}>닫기</button>
    </div>
  </section></main>;
}
