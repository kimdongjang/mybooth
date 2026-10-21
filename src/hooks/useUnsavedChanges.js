import { useEffect, useRef } from 'react';
import { confirmAction } from '../utils/confirmAction';
const guards = new Set();
let checking;
export async function allowNavigation() {
  if (![...guards].some(guard => guard.current)) return true;
  if (checking) return checking;
  checking = confirmAction('작성 중인 내용이 초기화됩니다. 다른 화면으로 이동할까요?', { title: '작성 중인 내용이 있습니다', confirmLabel: '이동', danger: false });
  const result = await checking; checking = null;
  if (result) guards.forEach(guard => { guard.current = false; });
  return result;
}
export function useUnsavedChanges(dirty) {
  const guard = useRef(dirty); guard.current = dirty;
  useEffect(() => {
    guards.add(guard);
    const beforeUnload = event => { if (guard.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { guards.delete(guard); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  return () => { guard.current = false; };
}
