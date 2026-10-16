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
  return <div className="page-tabs purchase-tabs" role="tablist" aria-label={label}>
    {tabs.map(([key, text], index) => <button key={key} type="button" id={`${id}-tab-${key}`} role="tab" aria-selected={selected === key} aria-controls={`${id}-panel-${key}`} tabIndex={selected === key ? 0 : -1} onClick={() => onSelect(key)} onKeyDown={(event) => onKeyDown(event, index)}>{text}</button>)}
  </div>;
}

export function AppHeader({ page, navigate, project, adminId, saving, sync, onReleaseProject, releaseDisabled }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const eventToggle = useRef(null);
  const eventGroup = useRef(null);
  const [eventOpen, setEventOpen] = useState(false);
  useEffect(() => { setOpen(false); setEventOpen(false); }, [page, project?.id]);
  useEffect(() => {
    if (!open && !eventOpen) return;
    const onEscape = (event) => {
      if (event.key === 'Escape') {
        if (eventOpen) { setEventOpen(false); eventToggle.current?.focus(); }
        else { setOpen(false); toggle.current?.focus(); }
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, eventOpen]);
  useEffect(() => {
    if (!eventOpen) return;
    const closeOutside = event => { if (!eventGroup.current?.contains(event.target)) setEventOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [eventOpen]);
  const go = (key) => { setOpen(false); setEventOpen(false); navigate(key); };
  return <header className="app-header border-b border-line bg-white text-ink">
    <div className="header-brand flex min-w-0 items-center gap-2.5"><div className="header-identity"><a href="#/sales" className="display-font brand-title font-bold" onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); go('pos'); }}><img className="brand-logo" src="/images/mybooth-rounded-logo.png" alt="MyBooth" width="1930" height="815" /></a></div>{saving && <span className="shrink-0 text-xs text-register">저장 중...</span>}</div>
    <div className="header-event" ref={eventGroup} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setEventOpen(false); }}>
      {project ? <>
        <button ref={eventToggle} type="button" className="event-picker" aria-expanded={eventOpen} aria-controls="selected-event-panel" onClick={() => { setOpen(false); setEventOpen(!eventOpen); }}>
          <Icon name="project" /><span className="event-picker-copy"><span className="event-picker-label">선택된 행사</span><span className="event-picker-name" title={project.name}>{project.name}</span></span><span aria-hidden="true">{eventOpen ? '▴' : '▾'}</span>
        </button>
        {eventOpen && <div id="selected-event-panel" className="event-picker-panel">
          <a href={`#${pagePaths.pos}`} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); go('pos'); }}>이 행사 판매 화면</a>
          <p>선택을 해제하면 행사 선택 화면으로 이동합니다. 로그인은 유지됩니다.</p>
          <button type="button" className="release-project" disabled={releaseDisabled} onClick={() => { setEventOpen(false); onReleaseProject(); }}>행사 선택 해제</button>
        </div>}
      </> : <a className="event-picker" href={`#${pagePaths.projects}`} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); go('projects'); }}><Icon name="project" />행사 선택</a>}
    </div>
    <div className="header-controls"><button data-guide={project && page === "pos" && !open ? "menu" : undefined} ref={toggle} type="button" className={`menu-toggle ${open ? 'is-open' : ''}`} aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="booth-navigation" onClick={() => { setEventOpen(false); setOpen(!open); }}><span className="hamburger-lines" aria-hidden="true"><span /><span /><span /></span></button></div>
    <nav id="booth-navigation" aria-label="부스 메뉴" className={`booth-navigation ${open ? 'is-open' : ''}`}>
      <div className="nav-screens">
        {[['inventory', '재고 관리'], ['account', '내 계정']].map(([key, label]) => <a key={key} href={`#${pagePaths[key]}`} aria-current={page === key ? 'page' : undefined} className={page === key ? 'is-active' : ''} onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault(); go(key);
        }}><Icon name={key === 'inventory' ? 'settings' : 'account'} />{label}</a>)}
      </div>
    </nav>
    {project && <div className="header-sync"><SyncStatus sync={sync} /></div>}
  </header>;
}
