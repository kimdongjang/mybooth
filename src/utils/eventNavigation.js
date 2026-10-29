// Navigation follows capabilities, never calendar-based automatic event selection.
export function eventDestination(project) {
  if (!project) return 'projects';
  const p = project.permissions || {};
  if (p.canSell || p.canViewPos) return 'pos';
  if (p.canSettle || p.canReadOwnHistory || p.ownerIds?.length) return 'log';
  return 'projects';
}

export function eventActionLabel(project) {
  const destination = eventDestination(project);
  if (destination === 'log') return project.permissions?.canSettle ? '판매 현황 열기' : '내 정산 열기';
  if (destination !== 'pos') return '행사 목록';
  if (project.archivedAt || project.settlementClosedAt) return '행사 내역 열기';
  return project.permissions?.canSell ? '판매 화면 열기' : '상품 목록 열기';
}

const lastEventKey = (actorId, mode) => `pos_last_event:${mode}:${encodeURIComponent(actorId)}`;
export function readLastEvent(storage, actorId, mode, projects) {
  if (!actorId) return null;
  try {
    const saved = JSON.parse(storage.getItem(lastEventKey(actorId, mode)) || 'null');
    return projects.find(project => project.id === saved?.id && project.boothId === saved.boothId && eventDestination(project) !== 'projects') || null;
  } catch { return null; }
}
export function rememberLastEvent(storage, actorId, mode, project) {
  if (!actorId) return;
  try {
    const key = lastEventKey(actorId, mode);
    if (project) storage.setItem(key, JSON.stringify({id:project.id, boothId:project.boothId}));
    else storage.removeItem(key);
  } catch { /* Event selection and locally saved orders remain usable without preferences. */ }
}
