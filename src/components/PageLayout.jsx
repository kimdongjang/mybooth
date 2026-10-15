import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import { SyncStatus } from './SyncStatus';
import { pagePaths, projectPages } from '../hooks/usePageRoute';

export function PageIntro({ title, description, children, actions }) {
  return <div className="page-intro">
    <div className="page-heading"><div><h1 tabIndex={-1}>{title}</h1><p>{description}</p></div>{actions && <div className="page-heading-actions">{actions}</div>}</div>
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
  return <div className="page-tabs purchase-tabs" role="tablist" aria-label={label}>
    {tabs.map(([key, text], index) => <button key={key} type="button" id={`${id}-tab-${key}`} role="tab" aria-selected={selected === key} aria-controls={`${id}-panel-${key}`} tabIndex={selected === key ? 0 : -1} onClick={() => onSelect(key)} onKeyDown={(event) => onKeyDown(event, index)}>{text}</button>)}
  </div>;
}

export function AppHeader({ page, navigate, project, adminId, saving, sync, onRefresh, onLogout }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  useEffect(() => { setOpen(false); }, [page, project?.id]);
  useEffect(() => {
    if (!open) return;
    const onEscape = (event) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open]);
  const go = (key) => { setOpen(false); navigate(key); };
  return <header className="app-header border-b border-line bg-white text-ink">
    <div className="header-brand flex min-w-0 items-center gap-2.5"><span className="h-2 w-2 shrink-0 rounded-full bg-register" /><div className="min-w-0"><a href="#/sales" className="display-font brand-title font-bold" onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); go('pos'); }}>마이 부스</a><p className="truncate text-xs text-slate-500" title={project?.name || adminId}>{project?.name || `${adminId}님의 프로젝트`}</p></div>{saving && <span className="shrink-0 text-xs text-register">저장 중...</span>}</div>
    <div className="header-controls">{project && <SyncStatus sync={sync} />}<button ref={toggle} type="button" className={`menu-toggle ${open ? 'is-open' : ''}`} aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="booth-navigation" onClick={() => setOpen(!open)}><span className="hamburger-lines" aria-hidden="true"><span /><span /><span /></span></button></div>
    <nav id="booth-navigation" aria-label="부스 메뉴" className={`booth-navigation ${open ? 'is-open' : ''}`}>
      <div className="nav-screens">{[['pos', '상품 판매'], ['settings', '상품 관리'], ['log', '정산'], ['project', '행사 관리'], ['projects', '행사 선택']].map(([key, label]) => !project && key !== 'projects' ? <button key={key} disabled><Icon name={key} />{label}</button> : <a key={key} href={`#${pagePaths[key]}`} aria-current={page === key || (key === 'settings' && page === 'bundleNew') || (key === 'project' && (projectPages.includes(page) || page === 'restore')) ? 'page' : undefined} onClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        go(key);
      }} className={page === key || (key === 'settings' && page === 'bundleNew') || (key === 'project' && (projectPages.includes(page) || page === 'restore')) ? 'is-active' : ''}><Icon name={key} />{label}</a>)}</div>
      <div className="nav-utilities"><button onClick={() => { setOpen(false); onRefresh(); }}><Icon name="refresh" />새로고침</button><button onClick={() => { setOpen(false); onLogout(); }}><Icon name="logout" />로그아웃</button></div>
    </nav>
  </header>;
}
