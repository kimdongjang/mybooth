import { pagePaths } from '../hooks/usePageRoute';

export const projectSections = [
  { page: 'project', title: '행사 개요', description: '현재 행사와 관리 항목을 한눈에 확인하세요.' },
  { page: 'projectName', title: '이름 변경', description: '행사 이름을 변경합니다. 상품과 판매 기록은 유지됩니다.' },
  { page: 'projectArchive', title: '보관·해제', description: '행사를 종료하고 기록을 보관하거나 판매를 다시 시작합니다.' },
  { page: 'projectDuplicate', title: '행사 복제', description: '같은 상품·세트 구성으로 다음 행사를 준비합니다.' },
  { page: 'projectDelete', title: '행사 삭제', description: '이 행사의 상품·재고·판매 기록을 영구 삭제합니다.', danger: true },
];

export function EventLink({ page, navigate, children, className = '', ...props }) {
  return <a {...props} className={className} href={`#${pagePaths[page]}`} onClick={event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(page);
  }}>{children}</a>;
}

export default function ProjectNavigation({ page, project, navigate }) {
  return <aside className="event-sidebar">
    <div className="event-sidebar-context"><span className="event-muted">현재 관리 중인 행사</span><strong>{project.name}</strong><span className="event-status" data-archived={Boolean(project.archivedAt)}>{project.archivedAt ? '보관 중 · 읽기 전용' : '진행 중'}</span></div>
    <nav aria-label="행사 관리 메뉴">{projectSections.map(item => <EventLink key={item.page} page={item.page} navigate={navigate} className={`event-side-link ${item.danger ? 'is-danger' : ''}`} aria-current={page === item.page || (page === 'restore' && item.page === 'projectBackup') ? 'page' : undefined}>{item.title}</EventLink>)}</nav>
    <EventLink page="pos" navigate={navigate} className="event-text-link event-return-link">← 판매 화면으로</EventLink>
  </aside>;
}
