import { useEffect, useRef, useState } from 'react';
import { toastEvent } from '../utils/toast';

const DURATION = { success: 3000, error: 5000 };
const EXIT_MS = 400;

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(0);
  const dismiss = id => {
    clearTimeout(timers.current.get(id));
    // Play the exit animation before the toast leaves the DOM.
    setToasts(current => current.map(toast => toast.id === id ? { ...toast, leaving: true } : toast));
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setToasts(current => current.filter(toast => toast.id !== id));
    }, EXIT_MS));
  };
  useEffect(() => {
    const onToast = event => {
      const { message, type } = event.detail;
      setToasts(current => {
        // The same message from nested handlers is shown once.
        if (current.some(toast => toast.message === message && toast.type === type && !toast.leaving)) return current;
        const id = ++nextId.current;
        timers.current.set(id, setTimeout(() => dismiss(id), DURATION[type] || DURATION.success));
        return [...current.slice(-2), { id, message, type }];
      });
    };
    window.addEventListener(toastEvent, onToast);
    return () => { window.removeEventListener(toastEvent, onToast); timers.current.forEach(clearTimeout); };
  }, []);
  return <div className="toast-region" aria-live="polite" aria-atomic="false">
    {toasts.map(toast => <div key={toast.id} className="toast" data-type={toast.type} data-leaving={toast.leaving || undefined} role={toast.type === 'error' ? 'alert' : 'status'}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">{toast.type === 'error'
        ? <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        : <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}</svg>
      <span>{toast.message}</span>
      <button type="button" aria-label="알림 닫기" onClick={() => dismiss(toast.id)}>×</button>
    </div>)}
  </div>;
}
