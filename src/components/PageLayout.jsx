import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import { SyncStatus } from './SyncStatus';
import { pagePaths } from '../hooks/usePageRoute';

export function PageIntro({ title, children, actions }) {
  return <div className="page-intro">
    <div className="page-heading"><div><h1 tabIndex={-1}>{title}</h1></div>{actions && <div className="page-heading-actions">{actions}</div>}</div>
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

export function AppHeader({ page, navigate, project, adminId, saving, sync, onReleaseProject, releaseDisabled }) {
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
    <div className="header-brand flex min-w-0 items-center gap-2.5"><div className="header-identity"><a href="#/sales" className="display-font brand-title font-bold" onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); go('pos'); }}><img className="brand-logo" src="/images/mybooth-rounded-logo.png" alt="MyBooth" width="1930" height="815" /></a><p className="header-event-name" title={project?.name || adminId}>{project?.name || (page === 'inventory' ? '내 재고' : page === 'account' ? '내 계정' : '행사 선택')}</p></div>{saving && <span className="shrink-0 text-xs text-register">저장 중...</span>}</div>
    <div className="header-controls">{project && <div className="mobile-sync"><SyncStatus sync={sync} /></div>}<button data-guide={project && page === "pos" && !open ? "menu" : undefined} ref={toggle} type="button" className={`menu-toggle ${open ? 'is-open' : ''}`} aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="booth-navigation" onClick={() => setOpen(!open)}><span className="hamburger-lines" aria-hidden="true"><span /><span /><span /></span></button></div>
    <nav id="booth-navigation" aria-label="부스 메뉴" className={`booth-navigation ${open ? 'is-open' : ''}`}>
      {project && <div className="navigation-sync"><SyncStatus sync={sync} /></div>}
      <div className="nav-screens">{[['projects', '행사'], ['inventory', '재고 관리'], ['account', '내 계정']].map(([key, label]) => {
        const active = key === 'projects' ? !['inventory', 'account'].includes(page) : page === key;
        const destination = key === 'projects' && project ? 'pos' : key;
        return <a key={key} href={`#${pagePaths[destination]}`} aria-current={active ? 'page' : undefined} className={active ? 'is-active' : ''} onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault(); go(destination);
        }}><Icon name={key === 'inventory' ? 'settings' : key === 'account' ? 'account' : 'project'} />{label}</a>;
      })}</div>
      <div className="nav-utilities">{project && <button className="release-project" disabled={releaseDisabled} onClick={() => { setOpen(false); onReleaseProject(); }}><Icon name="logout" />행사 선택 해제</button>}</div>
    </nav>
  </header>;
}
