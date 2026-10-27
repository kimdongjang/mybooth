import { pagePaths } from '../hooks/usePageRoute';

export const projectSections = [
  { page: 'project', title: '행사 정보' },
  { page: 'projectSettlement', title: '정산 마감' },
  { page: 'projectBackup', title: '데이터·관리' },
];

export function EventLink({ page, navigate, children, className = '', ...props }) {
  return <a {...props} className={className} href={`#${pagePaths[page]}`} onClick={event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(page);
  }}>{children}</a>;
}

export default function ProjectNavigation({ page, project, navigate }) {
  return <aside className="event-sidebar">
    <nav className="menu-tabs" aria-label="행사 관리 메뉴">{projectSections.map(item => <EventLink key={item.page} page={item.page} navigate={navigate} className={`event-side-link ${item.danger ? 'is-danger' : ''}`} aria-current={page === item.page || (['projectArchive','projectDelete'].includes(page) && item.page === 'projectBackup') || (page==='projectName'&&item.page==='project') ? 'page' : undefined}>{item.title}</EventLink>)}</nav>
    <EventLink page="pos" navigate={navigate} className="event-text-link event-return-link">← 판매 화면으로</EventLink>
  </aside>;
}
