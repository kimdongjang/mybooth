import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import { SyncStatus } from './SyncStatus';
import { pagePaths } from '../hooks/usePageRoute';

export function PageIntro({ title, children, actions, hideTitle = false }) {
  return <div className={hideTitle && !children && !actions ? "sr-only page-intro" : "page-intro"}>
    <div className={hideTitle && !actions ? "sr-only page-heading" : "page-heading"}><div><h1 tabIndex={-1}>{title}</h1></div>{actions && <div className="page-heading-actions">{actions}</div>}</div>
    {children}
  </div>;
}

export function PageTabs({ id, label, tabs, selected, onSelect }) {
  const onKeyDown = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    onSelect(tabs[next][0]);
    document.getElementById(`${id}-tab-${tabs[next][0]}`)?.focus();
  };
  return <div className="page-tabs purchase-tabs menu-tabs" role="tablist" aria-label={label}>
    {tabs.map(([key, text], index) => <button key={key} type="button" id={`${id}-tab-${key}`} role="tab" aria-selected={selected === key} aria-controls={`${id}-panel-${key}`} tabIndex={selected === key ? 0 : -1} onClick={() => onSelect(key)} onKeyDown={(event) => onKeyDown(event, index)}>{text}</button>)}
  </div>;
}

export function AppHeader({ page, navigate, project, saving, sync, onReleaseProject, releaseDisabled }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  useEffect(() => { setOpen(false); }, [page, project?.id]);
  useEffect(() => {
    if (!open) return;
    const onEscape = event => { if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open]);
  const go = key => { setOpen(false); navigate(key); };
  const follow = key => event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); go(key);
  };
  const showEventNav = project && !['projects', 'projectNew', 'inventory', 'account', 'dashboard', 'revenue', 'artistStock'].includes(page);
  const eventDestination = project ? (project.permissions?.canSell || project.permissions?.canViewPos ? 'pos' : 'log') : 'projects';
  const eventContext = (<div className="header-event">
      <a className="event-context-link" href={`#${pagePaths[eventDestination]}`} onClick={follow(eventDestination)}>
        <Icon name="project" /><span className="event-context-name" title={project?.name}>{project?.name || '행사 선택'}</span>
      </a>
    </div>);
  return <><header className="app-header border-b border-line bg-white text-ink">
    <div className="header-brand"><a href={`#${pagePaths[eventDestination]}`} className="display-font brand-title font-bold" onClick={follow(eventDestination)}><img className="brand-logo" src="/brand/withbooth-final-logo.png" alt="WithBooth" width="1930" height="815" /></a>{saving && <span className="sr-only" role="status">저장 중...</span>}</div>
    <div className="header-event-desktop">{eventContext}</div>
    {project && <div className="header-sync"><SyncStatus sync={sync} /></div>}
    <div className="header-controls"><button data-guide={project && page === 'pos' && !open ? 'menu' : undefined} ref={toggle} type="button" className={`menu-toggle ${open ? 'is-open' : ''}`} aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="booth-navigation" onClick={() => setOpen(!open)}><span className="hamburger-lines" aria-hidden="true"><span /><span /><span /></span></button></div>
    <nav id="booth-navigation" aria-label="부스 메뉴" className={`booth-navigation ${open ? 'is-open' : ''}`}>
      <div className="nav-screens menu-tabs">{[['dashboard', '대시보드'], ['projects', '행사 선택'], ['inventory', '내 재고관리'], ['account', '마이페이지']].map(([key, label]) => <a key={key} href={`#${pagePaths[key]}`} aria-current={page === key || key === 'account' && page === 'revenue' ? 'page' : undefined} className={page === key || key === 'account' && page === 'revenue' ? 'is-active' : ''} onClick={follow(key)}><Icon name={(key.startsWith('inventory') || key === 'artistStock') ? 'settings' : key==='projects'?'project':key} />{label}</a>)}</div>
    </nav>
    </header>
    {showEventNav && <div className="header-secondary">
      <nav className="event-subnav menu-tabs" aria-label="행사 메뉴">{[['pos', '판매 목록'], ['settings', '행사 판매 설정'], ['log', '판매현황'], ['project', '행사 관리']].filter(([key])=>key==='pos'?project.permissions?.canSell||project.permissions?.canViewPos:key==='project'?project.permissions?.canManage:key==='log'?project.permissions?.canSettle||project.permissions?.canReadOwnHistory||project.permissions?.ownerIds?.length:project.permissions?.canConfigure||project.permissions?.ownerIds?.length).map(([key, label]) => <button key={key} type="button" data-guide={key === 'settings' && page === 'pos' ? 'manage' : undefined} aria-current={page === key || key === 'project' && page.startsWith('project') ? 'page' : undefined} onClick={() => go(key)}>{label}</button>)}</nav>
    </div>}
  </>;
}
