import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import { SyncStatus } from './SyncStatus';
import { pagePaths } from '../hooks/usePageRoute';
import { eventDestination, eventActionLabel } from '../utils/eventNavigation';
import { eventSchedule, sortEventsBySchedule } from '../utils/eventSchedule';

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

export function AppHeader({ page, navigate, project, projects = [], onSelectProject, saving, sync, selectionDisabled }) {
  const [open, setOpen] = useState(null);
  const root = useRef(null);
  const eventToggle = useRef(null);
  const moreToggle = useRef(null);
  const menuToggle = useRef(null);
  useEffect(() => { setOpen(null); }, [page, project?.id]);
  useEffect(() => {
    if (!open) return;
    const onEscape = event => {
      if (event.key === 'Escape') {
        setOpen(null);
        (open === 'events' ? eventToggle : open === 'menu' ? menuToggle : moreToggle).current?.focus();
      }
    };
    const onOutside = event => { if (!root.current?.contains(event.target)) setOpen(null); };
    const onBlur = event => { if (!root.current?.contains(event.relatedTarget)) setOpen(null); };
    document.addEventListener('keydown', onEscape);
    document.addEventListener('pointerdown', onOutside);
    const header = root.current;
    header?.addEventListener('focusout', onBlur);
    return () => {
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('pointerdown', onOutside);
      header?.removeEventListener('focusout', onBlur);
    };
  }, [open]);
  const go = key => { setOpen(null); return navigate(key); };
  const follow = key => event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); void go(key);
  };
  const destination = eventDestination(project);
  const personalPages = ['projects', 'projectNew', 'projectDuplicate', 'inventory', 'account', 'dashboard', 'revenue', 'artistStock'];
  const showEventNav = Boolean(project);
  const onPersonalPage = personalPages.includes(page);
  const moreActive = ['dashboard', 'account', 'revenue'].includes(page);
  const permissions = project?.permissions || {};
  const eventMenu = showEventNav ? [['pos', '판매'], ['log', '판매현황'], ['settings', '행사 판매 설정'], ['project', '행사 관리']].filter(([key]) => key === 'pos' ? permissions.canSell || permissions.canViewPos : key === 'project' ? permissions.canManage : key === 'log' ? permissions.canSettle || permissions.canReadOwnHistory || permissions.ownerIds?.length : permissions.canConfigure || permissions.ownerIds?.length) : [];
  const eventMenuCurrent = key => !onPersonalPage && (page === key || key === 'project' && page.startsWith('project') || key === 'settings' && ['productNew','bundleNew'].includes(page));
  const accountMenu = [['projects','행사 목록'],['inventory','내 재고관리'],['dashboard','대시보드'],['account','마이페이지']];
  return <><header ref={root} className="app-header sales-app-header border-b border-line bg-white text-ink">
    <div className="header-brand"><a href={`#${pagePaths[destination]}`} className="display-font brand-title font-bold" onClick={follow(destination)} aria-label="WithBooth 판매"><img className="brand-logo" src="/brand/withbooth-final-logo.png" alt="WithBooth" width="1930" height="815" /></a>{saving && <span className="sr-only" role="status">저장 중...</span>}</div>
    <div className="event-switcher">
      <button ref={eventToggle} type="button" className="event-switcher-trigger" aria-expanded={open === 'events'} aria-controls="header-event-list" onClick={() => setOpen(open === 'events' ? null : 'events')}><Icon name="project"/><span className="event-context-name" title={project?.name}>{project?.name || '행사 선택'}</span><span aria-hidden="true">▾</span></button>
      {open === 'events' && <section id="header-event-list" className="header-popover event-switcher-panel" aria-label="행사 변경">
        <ul>{sortEventsBySchedule(projects).map(item => {
          const schedule = eventSchedule(item);
          return <li key={item.id}><button type="button" className="event-switcher-option" aria-current={item.id === project?.id ? 'true' : undefined} disabled={selectionDisabled} aria-label={`${item.name} · ${eventActionLabel(item)}`} onClick={async () => { if (await onSelectProject(item) !== false) { setOpen(null); eventToggle.current?.focus(); } }}>
            <span className="event-switcher-name">{item.boothName && !/^기본\s*부스$/.test(item.boothName.trim()) && <span>{item.boothName} · </span>}{item.name}{item.id === project?.id && <span className="event-current-label">✓ 선택된 행사</span>}</span>
            <span className="event-switcher-meta"><span className={`inventory-event-status is-${schedule.status}`}>{schedule.label}</span><span>{schedule.period || '일정 미설정'}</span></span>
          </button></li>;
        })}</ul>
        <a className="event-switcher-all" href="#/projects" onClick={follow('projects')}>전체 행사 보기 →</a>
      </section>}
    </div>
    {project && <div className="header-sync"><SyncStatus sync={sync} /></div>}
    <button ref={menuToggle} type="button" className="header-menu-toggle" aria-label="메뉴" aria-expanded={open === 'menu' || open === 'more'} aria-controls="header-navigation" onClick={() => setOpen(open === 'menu' || open === 'more' ? null : 'menu')}><span aria-hidden="true"/><span aria-hidden="true"/><span aria-hidden="true"/></button>
    {showEventNav ? <nav id="header-navigation" className={`primary-navigation event-workspace-navigation${open === 'menu' || open === 'more' ? ' is-open' : ''}`} aria-label="행사 메뉴">
      {eventMenu.map(([key, label]) => <a key={key} href={`#${pagePaths[key]}`} data-guide={key === 'settings' && page === 'pos' ? 'manage' : undefined} aria-current={eventMenuCurrent(key) ? 'page' : undefined} onClick={follow(key)}><Icon name={key}/>{label}</a>)}
      <div className="primary-more">
        <button ref={moreToggle} type="button" className={onPersonalPage ? 'is-active' : undefined} aria-expanded={open === 'more'} aria-controls="header-more-menu" onClick={() => setOpen(open === 'more' ? null : 'more')}><Icon name="account"/>내 계정 <span aria-hidden="true">▾</span></button>
        {open === 'more' && <div id="header-more-menu" className="header-popover" aria-label="내 계정 메뉴">{accountMenu.map(([key, label]) => <a key={key} href={`#${pagePaths[key]}`} aria-current={page === key || (key === 'projects' && ['projectNew','projectDuplicate'].includes(page)) || (key === 'inventory' && page === 'artistStock') ? 'page' : undefined} onClick={follow(key)}><Icon name={key}/>{label}</a>)}</div>}
      </div>
    </nav> : <nav id="header-navigation" className={`primary-navigation${open === 'menu' || open === 'more' ? ' is-open' : ''}`} aria-label="주 메뉴">
      <a href={`#${pagePaths[destination]}`} className="primary-sales" aria-current={page === 'pos' ? 'page' : undefined} onClick={follow(destination)}><Icon name="pos"/>판매</a>
      <a href="#/projects" aria-current={['projects','projectNew','projectDuplicate'].includes(page) ? 'page' : undefined} onClick={follow('projects')}><Icon name="projects"/>행사 목록</a>
      <a href="#/inventory" aria-current={['inventory','artistStock'].includes(page) ? 'page' : undefined} onClick={follow('inventory')}><Icon name="inventory"/>내 재고관리</a>
      <div className="primary-more">
        <button ref={moreToggle} type="button" className={moreActive ? 'is-active' : undefined} aria-expanded={open === 'more'} aria-controls="header-more-menu" onClick={() => setOpen(open === 'more' ? null : 'more')}><Icon name="more"/>더보기 <span aria-hidden="true">▾</span></button>
        {open === 'more' && <div id="header-more-menu" className="header-popover" aria-label="더보기 메뉴">{[['dashboard','대시보드'],['account','마이페이지']].map(([key,label]) => <a key={key} href={`#${pagePaths[key]}`} aria-current={page === key || (key === 'account' && page === 'revenue') ? 'page' : undefined} onClick={follow(key)}><Icon name={key}/>{label}</a>)}</div>}
      </div>
    </nav>}
  </header></>;
}
