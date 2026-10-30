import { Analytics } from '@vercel/analytics/react';
import PaymentToast from './components/PaymentToast';
import ToastHost from './components/ToastHost';
import { showToast, toastApiSuccess, toastApiFailure } from './utils/toast';
import LoadingState from './components/LoadingState';
import ApiReadIndicator from './components/ApiReadIndicator';
import {apiReadTracker} from './utils/apiReadTracker';
import {countDashboardWaiting} from './utils/personalDashboard';
import {eventDestination, readLastEvent, rememberLastEvent} from './utils/eventNavigation';
import RevenuePage from './pages/RevenuePage';
import { settlementEntries } from './utils/settlementEntries';
import DashboardPage from './pages/DashboardPage';
import AccountPage from './pages/AccountPage';
import ArtistStockPage from './pages/ArtistStockPage';
import PersonalInventory from './pages/PersonalInventory';
import PersonalOverview from './pages/PersonalOverview';
import {createApiContractContext} from './utils/apiContractContext';
import { allowNavigation, useUnsavedChanges } from './hooks/useUnsavedChanges';
import { sessionStore, saveProjectList, readProjectList, isNative } from './platform/mobile';
import InventoryPage from './pages/InventoryPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import SalesPage from './pages/SalesPage';
import ProductsPage from './pages/ProductsPage';
import SettlementPage from './pages/SettlementPage';
import ProjectsPage from './pages/ProjectsPage';
import EventInvitePage from './pages/EventInvitePage';
import ProjectManagementPage from './pages/ProjectManagementPage';
import ProjectRestorePage from './pages/ProjectRestorePage';
import { AppHeader, PageIntro, PageTabs } from './components/PageLayout';
import { Input } from './components/PosUI';
import { pagePaths, pageTitles, projectPages, pageForHash, productIdForHash, usePageRoute } from './hooks/usePageRoute';
import { uid, won, creatorNameOf, eventCreatorNameOf, productNameFromFields, productNameWithoutCreator, normalizeProductForClient, compareProductSaleNumber } from './utils/productDisplay';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { orderRepository } from './database/orderRepository';
import { stateRepository } from './database/stateRepository';
import { localData } from './data/localFirst';
import { createEventReadCache } from './data/eventReadCache';
import { useSync } from './hooks/useSync';
import { createLocalOrderId } from './utils/orderId';
import { SYNC_INTERVAL_MS } from './sync/backgroundSync';

const AUTH_TOKEN_KEY = 'pos_admin_token';
const AUTH_ADMIN_KEY = 'pos_admin_id';
const apiContracts=createApiContractContext();

async function requestJson(url, options = {}) {
  const token = sessionStore.getItem(AUTH_TOKEN_KEY);
  options=apiContracts.prepare(token,url,options);
  const {background,...fetchOptions}=options;
  return apiReadTracker.run(url,options,async()=>{
  const res = await fetch(url, {
    ...fetchOptions,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const failure = Object.assign(new Error(data.error || '요청 처리에 실패했습니다.'), { status: res.status });
    toastApiFailure(failure, options);
    throw failure;
  }
  apiContracts.observe(token,url,data);
  toastApiSuccess(options);
  return data;
  });
}

export default function App() {
  const [token, setToken] = useState(() => sessionStore.getItem(AUTH_TOKEN_KEY));
  const [profileImage, setProfileImage] = useState('');
  const [adminId, setAdminId] = useState(() => sessionStore.getItem(AUTH_ADMIN_KEY) || '');
  const [loading, setLoading] = useState(Boolean(token));
  const [projectLoading, setProjectLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [paymentToast,setPaymentToast]=useState(null);
  const [projects, setProjects] = useState([]);
  const [workspace,setWorkspace]=useState({profiles:[],booths:[],events:[]});
  const [selectedProject, setSelectedProject] = useState(null);
  const [dataRevision, setDataRevision] = useState(null);
  const viewerOnly = Boolean(selectedProject?.permissions?.canViewPos && !selectedProject.permissions.canSell && !selectedProject.permissions.canConfigure);
  const readOnly = Boolean(selectedProject?.archivedAt || selectedProject?.settlementClosedAt || viewerOnly);
  const [readyScope, setReadyScope] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [routePage, setScreen, routeHash] = usePageRoute();
  const loginReturnPath = useRef(!token && pageForHash(routeHash) && !['login','signup'].includes(routePage) ? routeHash.slice(1) : null);
  const rememberProject = project => rememberLastEvent(localStorage, adminId, import.meta.env.MODE, project);
  const routeParams = new URLSearchParams(routeHash.split('?')[1] || '');
  const linkedProjectId = ['pos','project','projectSettlement','log', 'settings'].includes(routePage) ? routeParams.get('projectId') : null;
  const routeProductId = routePage === 'settings' ? productIdForHash(routeHash) || routeParams.get('productId') || '' : '';
  const screen = selectedProject || linkedProjectId || ['restore', 'projectNew', 'inventory', 'account', 'dashboard', 'revenue', 'artistStock', 'invite'].includes(routePage) ? routePage : 'projects';
  const [orderExpanded, setOrderExpanded] = useState(false);


  useEffect(()=>{setPaymentToast(null);},[screen,selectedProject?.id,adminId]);
  useEffect(() => { setOrderExpanded(false); }, [screen, selectedProject?.id]);
  useEffect(() => {
    if (!token) {
      if (!['login', 'signup'].includes(routePage)) setScreen('login', true);
      document.title = `${routePage === 'signup' ? '회원가입' : '로그인'} · 위드부스`;
      return;
    }
    if (loading || projectLoading) return;
    if (linkedProjectId && selectedProject?.id !== linkedProjectId) return;
    if (['login', 'signup'].includes(routePage)) {
      const destination = loginReturnPath.current;
      loginReturnPath.current = null;
      setScreen(destination || eventDestination(selectedProject), true); return;
    }
    if(selectedProject?.permissions&&!['inventory','account','dashboard','revenue','projects','projectNew','artistStock','invite'].includes(routePage)) {
      const p=selectedProject.permissions;
      if(routePage==='pos'&&!p.canSell&&!p.canViewPos||routePage==='log'&&!p.canSettle&&!p.canReadOwnHistory&&!p.ownerIds?.length||projectPages.includes(routePage)&&!p.canManage||['settings','bundleNew','productNew'].includes(routePage)&&!p.canConfigure&&!p.ownerIds?.length){setScreen(eventDestination(selectedProject),true);return;}
    }
    if(routePage==='artistStock'){setScreen('inventory',true);return;}
    if (!selectedProject && !linkedProjectId && !['projects', 'projectNew', 'restore', 'inventory', 'account', 'dashboard', 'revenue', 'artistStock', 'invite'].includes(routePage)) setScreen('projects', true);
    else if (!pageForHash(routeHash)) setScreen(eventDestination(selectedProject), true);
    document.title = `${pageTitles[screen]} · 위드부스`;
    document.querySelector('.page-heading h1')?.focus();
  }, [screen, routePage, routeHash, token, loading, projectLoading, selectedProject?.id, selectedProject?.permissions?.canSell, selectedProject?.permissions?.canViewPos, selectedProject?.permissions?.canSettle, selectedProject?.permissions?.canReadOwnHistory, selectedProject?.permissions?.canManage, selectedProject?.permissions?.canConfigure, selectedProject?.permissions?.ownerIds?.length, setScreen]);
  const [settingsTab, setSettingsTab] = useState('products');
  useEffect(() => { if (screen === 'settings' && (linkedProjectId || routeProductId)) setSettingsTab('products'); else if (screen === 'bundleNew') setSettingsTab('bundles'); else if (screen === 'productNew') setSettingsTab('products'); }, [screen, selectedProject?.id, linkedProjectId, routeProductId]);
  const [products, setProducts] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [sales, setSales] = useState([]);
  const [cart, setCart] = useState([]);
  useUnsavedChanges(cart.length > 0);
  const [bundleRows, setBundleRows] = useState([{ productId: '', qty: 1 }]);
  const [bundleName, setBundleName] = useState('');
  const [bundlePrice, setBundlePrice] = useState('');
  const clearRegistration = useUnsavedChanges((screen === 'projectNew' && Boolean(newProjectName.trim())) || (screen === 'bundleNew' && Boolean(bundleName.trim() || bundlePrice || bundleRows.some(row => row.productId))));
  useEffect(() => { if (screen !== 'projectNew') setNewProjectName(''); if (screen !== 'bundleNew') { setBundleName(''); setBundlePrice(''); setBundleRows([{ productId: '', qty: 1 }]); } }, [screen]);
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [purchaseTab, setPurchaseTab] = useState('products');
  useEffect(() => {
    setCreatorFilter('all');
    setPurchaseTab('products');
    setSettingsTab(screen === 'bundleNew' ? 'bundles' : 'products');
    setLogCreatorFilter('all');
    setBundleRows([{ productId: '', qty: 1 }]);
    setBundleName('');
    setBundlePrice('');
  }, [selectedProject?.id]);
  const [logCreatorFilter, setLogCreatorFilter] = useState('all');
  const activeScope = useRef(null);
  const scope = `${token || ''}:${selectedProject?.boothId || ''}:${selectedProject?.id || ''}`;
  activeScope.current = scope;
  const activeToken = useRef(token);
  activeToken.current = token;
  const getAuthToken = useCallback(() => token, [token]);
  useEffect(() => {
    if (!token || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('pos-project-lifecycle');
    channel.onmessage = ({ data }) => {
      if(data.action==='eventDeleted'&&data.projectId){setProjects(current=>current.filter(p=>p.id!==data.projectId));setWorkspace(current=>({...current,events:current.events.filter(p=>p.id!==data.projectId)}));if(selectedProject?.id===data.projectId){activeScope.current=`${token||''}:`;setSelectedProject(null);setReadyScope(null);setProducts([]);setBundles([]);setSales([]);setCart([]);rememberProject(null);setScreen('projects');}void stateRepository.remove(data.projectId);return;}
      if(data.action==='creatorAccountChanged'){void loadProjects({background:true});void eventReads.invalidate().then(()=>eventReads.refresh({activeOnly:true})).catch(()=>{});if(selectedProject?.id)void loadState({background:true});return;}
      if(data.action==='sharedStockChanged'&&data.projectIds?.includes(selectedProject?.id)){void loadState({background:true});return;}
      if(data.adminId===adminId && data.action==='settlementChanged'){setSelectedProject(current=>current?.id===data.projectId?{...current,settlementClosedAt:data.closedAt}:current);if(selectedProject?.id===data.projectId)setCart([]);void stateRepository.setSettlementClosedAt(data.projectId,data.closedAt);return;}
      if (data.adminId !== adminId || !data.projectId || !['archiveProject', 'unarchiveProject'].includes(data.action)) return;
      setProjects(current => current.map(project => project.id === data.projectId ? { ...project, archivedAt: data.archivedAt } : project));
      setSelectedProject(current => current?.id === data.projectId ? { ...current, archivedAt: data.archivedAt } : current);
      if (selectedProject?.id === data.projectId) setCart([]);
      void stateRepository.setArchivedAt(data.projectId, data.archivedAt);
    };
    return () => channel.close();
  }, [token, adminId, selectedProject?.id]);
  const eventReads=useMemo(()=>createEventReadCache({scope:{actorId:adminId,boothId:selectedProject?.boothId,projectId:selectedProject?.id},request:requestJson,isCurrent:()=>activeScope.current===scope}),[token,adminId,selectedProject?.boothId,selectedProject?.id]);
  const sync = useSync({ enabled: Boolean(token && selectedProject?.id && readyScope === scope && !readOnly && selectedProject?.permissions?.canSell), refreshEnabled: Boolean(token && selectedProject?.id && readyScope === scope), onRefresh: async () => {const accepted=await loadState({background:true});return accepted===false?false:eventReads.refresh({activeOnly:true});}, getAuthToken, projectId: selectedProject?.id, actorId: adminId, boothId: selectedProject?.boothId });
  const stateReads = useRef(new Map());
  const workspaceReads = useRef(new Map());

  const applyState = async (data, fromCache = false, queueVersion) => {
    if (activeScope.current !== scope) return;
    if (!fromCache) data = await stateRepository.acceptRemote(selectedProject.id, { ...data, products: (data.products || []).map(normalizeProductForClient), dataRevision: data.dataRevision || null }, queueVersion);
    if (activeScope.current !== scope) return;
    const nextProducts = (data.products || []).map(normalizeProductForClient);
    const nextBundles = data.bundles || [];
    const nextSales = data.sales || [];
    if (activeScope.current !== scope) return;
    setProducts(nextProducts);
    setBundles(nextBundles);
    setSales(nextSales);
    setDataRevision(data.dataRevision || null);
    const nextArchivedAt = (fromCache && selectedProject.archivedAt) || data.archivedAt || null;
    setSelectedProject(current => current?.id === selectedProject.id ? { ...current, boothId: data.boothId ?? current.boothId ?? null, archivedAt: nextArchivedAt, settlementClosedAt: data.settlementClosedAt || null } : current);
    if (nextArchivedAt || data.settlementClosedAt) setCart([]);
    setReadyScope(scope);
  };

  const logout = async () => {
    if (!await allowNavigation()) return;
    setScreen('login', true);
    sessionStore.removeItem(AUTH_TOKEN_KEY);
    sessionStore.removeItem(AUTH_ADMIN_KEY);
    setToken(null);
    setAdminId('');
    setProjects([]);
    setWorkspace({profiles:[],booths:[],events:[]});
    setSelectedProject(null);
    setProducts([]);
    setBundles([]);
    setSales([]);
    setCart([]);
  };

  const loadState = (options = {}) => {
    if (stateReads.current.has(scope)) return stateReads.current.get(scope);
    const pending = loadStateOnce(options).finally(() => {
      if (stateReads.current.get(scope) === pending) stateReads.current.delete(scope);
    });
    stateReads.current.set(scope, pending);
    return pending;
  };
  const loadStateOnce = async ({background=false}={}) => {
    if (!selectedProject?.id) return;
    if(selectedProject.permissions&&!selectedProject.permissions.canSell&&!selectedProject.permissions.canConfigure&&!selectedProject.permissions.canViewPos){setReadyScope(scope);setProducts([]);setBundles([]);setSales([]);setLoading(false);return;}
    if(!background){setLoading(true);setError('');}
    try {
      const cached = await stateRepository.getForActor(selectedProject.id, adminId);
      if (activeScope.current !== scope) return;
      const usableCache=cached&&(!selectedProject.boothId||cached.boothId===selectedProject.boothId)&&(!['pxwiu2t','s4fjgga'].includes(selectedProject.id)||cached.dataRevision);
      if(usableCache&&!background){await applyState(cached,true);return true;}
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (usableCache) {
          return;
        }
        setError('오프라인 상태입니다. 저장된 데이터가 없어 상품을 불러올 수 없습니다.');
        return;
      }

      const queueVersion = await stateRepository.queueVersion(selectedProject.id);
      const data = await requestJson(`/api/pos?projectId=${encodeURIComponent(selectedProject.id)}&boothId=${encodeURIComponent(selectedProject.boothId||'')}`,{background,signal:AbortSignal.timeout(20_000)});
      if (activeScope.current !== scope) return;
      // Preserve the durable local projection until every command is acknowledged.
      if (await orderRepository.countWaiting(selectedProject.id)) {
        // acceptRemote validates the authenticated owner and retains the pending
        // projection, including an unbound pre-upgrade cache, atomically.
        await applyState(data, false, queueVersion);
      } else await applyState(data, false, queueVersion);
      return true;
    } catch (err) {
      if (activeScope.current !== scope) return;
      if (String(err.message).includes('인증')) logout();
      else if ([403,404].includes(err.status)) {
        setReadyScope(null); setProducts([]); setBundles([]); setSales([]); setCart([]);
        setError(err.message);
      }
      else {
        const cached = await stateRepository.getForActor(selectedProject.id, adminId);
        if (activeScope.current !== scope) return;
        if (cached && (!selectedProject.boothId || cached.boothId === selectedProject.boothId) && (!['pxwiu2t', 's4fjgga'].includes(selectedProject.id) || cached.dataRevision)) {
          await applyState(cached, true);
          if(!background)setError('오프라인 상태입니다. 마지막 저장 데이터를 사용합니다.');
        } else setError(err.message);
      }
      return false;
    } finally {
      if (activeScope.current === scope) setLoading(false);
    }
  };

  const loadProjects = (options = {}) => {
    if(workspaceReads.current.has(token))return workspaceReads.current.get(token);
    const pending=loadProjectsOnce(options).finally(()=>{
      if(workspaceReads.current.get(token)===pending)workspaceReads.current.delete(token);
    });
    workspaceReads.current.set(token,pending);
    return pending;
  };
  const loadProjectsOnce = async ({background=false}={}) => {
    if (!token) return;
    if(!background){setProjectLoading(true);setError('');}
    const isCurrent=()=>activeToken.current===token;
    const accept=data=>{
      if(!isCurrent()||!data)return;
      setWorkspace(data);
      const nextProjects=data.events||[];
      saveProjectList(adminId,nextProjects);
      setProjects(nextProjects);
      const remembered=readLastEvent(localStorage,adminId,import.meta.env.MODE,nextProjects);
      setSelectedProject(current=>nextProjects.find(project=>project.id===current?.id && project.boothId===current.boothId)||remembered||null);
      setProjectLoading(false);
      setLoading(false);
    };
    const reject=err=>{
      if(!isCurrent())return;
      if([401,403,404].includes(err.status)){
        setWorkspace({profiles:[],booths:[],events:[]});setProjects([]);setSelectedProject(null);
        setProducts([]);setBundles([]);setSales([]);setReadyScope(null);
      }
      if(err.status===401)void logout();
      else if(!background||err.status)setError(err.message);
    };
    try {
      const cached=await localData.get({actorId:adminId},'workspace');
      const result=await localData.read({scope:{actorId:adminId},resource:'workspace',fetchRemote:()=>requestJson('/api/booths?workspace=home',{background:background||Boolean(cached),signal:AbortSignal.timeout(20_000)}),isCurrent});
      accept(result.value);
      if(result.source==='local')await result.refresh.then(accept).catch(reject);
    } catch (err) {
      if (activeToken.current !== token) return;
      if (err.status === 401 || String(err.message).includes('인증')) logout();
      else {
        const cached = isNative && !err.status ? readProjectList(adminId) : null;
        if (cached) {
          setProjects(cached);
          const remembered = readLastEvent(localStorage,adminId,import.meta.env.MODE,cached);
          setSelectedProject(remembered || null);
          setError('오프라인 상태입니다. 저장된 행사 목록을 사용합니다.');
        } else reject(err);
      }
    } finally {
      if(isCurrent()){setProjectLoading(false);setLoading(false);}
    }
  };

  const createProject = async (e) => {
    e?.preventDefault();
    if (!newProjectName.trim()) return alert('프로젝트 이름을 입력해주세요.');
    setProjectLoading(true);
    setError('');
    try {
      const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ protocolVersion:2,boothId:e?.currentTarget?.elements?.namedItem('boothId')?.value,action: 'createProject', payload: { name: newProjectName.trim(),venue:e?.currentTarget?.elements?.namedItem('venue')?.value||'',startsOn:e?.currentTarget?.elements?.namedItem('startsOn')?.value||'',endsOn:e?.currentTarget?.elements?.namedItem('endsOn')?.value||'' } }) });
      const project = data.project;
      clearRegistration();
      setNewProjectName('');
      const home=await requestJson('/api/booths?workspace=home');
      const created=home.events.find(p=>p.id===project.id);
      if(!created)throw new Error('행사는 저장되었지만 목록을 확인하지 못했습니다. 행사 목록을 새로 불러와주세요.');
      if(activeToken.current!==token)return;
      setWorkspace(home);
      await localData.put({actorId:adminId},'workspace',home);
      setProjects(home.events);
      saveProjectList(adminId,home.events);
      await selectProject(created, {created:true});
    } catch (err) {
      showToast(err.message, 'error');
      setError(err.message);
      return false;
    } finally {
      setProjectLoading(false);
    }
  };

  const manageProject = async (project, action, payload) => {
    if (!navigator.onLine) throw new Error('온라인에서 프로젝트를 관리해주세요.');
    if (project && ['deleteProject', 'archiveProject', 'duplicateProject', 'backupProject'].includes(action) && await orderRepository.countWaiting(project.id)) {
      throw new Error('이 기기에 미동기화 주문이 있습니다. 해당 프로젝트에서 동기화를 완료한 후 다시 진행해주세요.');
    }
    const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ protocolVersion:2,boothId:project?.boothId || payload.boothId,projectId: project?.id, action, payload }) });
    if (activeToken.current !== token) return;
    if (action === 'backupProject') {
      downloadBlob(JSON.stringify(data.backup), 'application/json;charset=utf-8;', `${project.name.replace(/[<>:"/\\|?*]/g,'_')}_${new Intl.DateTimeFormat('sv-SE').format(new Date())}.json`);
      return data;
    }
    const home=await requestJson('/api/booths?workspace=home');
    if(activeToken.current!==token)return;
    setWorkspace(home);setProjects(home.events);saveProjectList(adminId,home.events);
    await localData.put({actorId:adminId},'workspace',home);
    const nextProjects=home.events;
    if (action === 'deleteProject') {
      if (selectedProject?.id === project.id) {
        activeScope.current=`${token||''}:`;setReadyScope(null);
        setSelectedProject(null);
        rememberProject(null);
        setProducts([]); setBundles([]); setSales([]); setCart([]);
        setScreen('projects');
      }
      await stateRepository.remove(project.id);
      if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('pos-project-lifecycle');channel.postMessage({action:'eventDeleted',projectId:project.id});channel.close();}
    } else if (project) {
      setSelectedProject(current => current?.id === project.id ? ({...current,...nextProjects.find(item => item.id === project.id)}) : current);
      if (['archiveProject', 'unarchiveProject'].includes(action)) {
        const value = nextProjects.find(item => item.id === project.id)?.archivedAt || null;
        if (activeScope.current === scope && selectedProject?.id === project.id) setCart([]);
        await stateRepository.setArchivedAt(project.id, value);
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('pos-project-lifecycle');
          channel.postMessage({ adminId, projectId: project.id, action, archivedAt: value });
          channel.close();
        }
      }
    }
    return { ...data, project: nextProjects.find(item => item.id === data.project?.id) || data.project };
  };

  const selectProject = async (project, options = {}) => {
    if (saving || (!options.created && (loading || projectLoading))) return false;
    const destination = options.destination || eventDestination(project);
    if (project.id === selectedProject?.id && project.boothId === selectedProject?.boothId) {
      await setScreen(destination);
      return true;
    }
    if (!options.navigationAccepted && !await allowNavigation()) return false;
    if (activeToken.current !== token) return false;
    // Invalidate in-flight responses before changing the event scope. Queued orders stay in IndexedDB.
    activeScope.current = `${token || ''}:${project.boothId || ''}:${project.id}`;
    setReadyScope(null);
    setError('');
    setSelectedProject(project);
    rememberProject(project);
    setProducts([]);
    setBundles([]);
    setSales([]);
    setCart([]);
    await setScreen(destination);
    return true;
  };

  useEffect(() => {
    if (!token || loading || saving || projectLoading || !linkedProjectId) return;
    const target = projects.find(project => project.id === linkedProjectId);
    if (!target) { setError('행사를 찾을 수 없거나 접근 권한이 없습니다.'); setScreen('projects', true); return; }
    if (selectedProject?.id !== target.id) selectProject(target, { navigationAccepted: true, destination: routeHash.slice(1) });
  }, [token, loading, saving, projectLoading, linkedProjectId, projects, selectedProject?.id]);

  useEffect(() => { if (token && (!selectedProject || ['projects','dashboard','revenue'].includes(screen))) loadProjects(); }, [token, screen === 'projects', screen === 'dashboard', screen === 'revenue']);
  useEffect(()=>{
    if(!token)return;
    const refresh=()=>{void loadProjects({background:true});};
    const timer=screen==='dashboard'?0:window.setInterval(()=>{if(!document.hidden)refresh();},SYNC_INTERVAL_MS);window.addEventListener('online',refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener('online',refresh);};
  },[token,adminId,screen==='dashboard']);
  useEffect(() => { let active = true; if (!token) { setProfileImage(''); return; } requestJson('/api/pos?account=true').then(data => { if (active) setProfileImage(data.admin?.avatar || ''); }).catch(() => {}); return () => { active = false; }; }, [token]);
  useEffect(() => { if (token && selectedProject?.id) loadState(); }, [token, selectedProject?.id, selectedProject?.boothId]);

  const login = async (credentials) => {
    const data = await requestJson('/api/auth', { method: 'POST', body: JSON.stringify(credentials) });
    sessionStore.setItem(AUTH_TOKEN_KEY, data.token);
    sessionStore.setItem(AUTH_ADMIN_KEY, data.admin?.id || credentials.id);
    setLoading(true);
    setProjectLoading(true);
    setSelectedProject(null);
    setProjects([]);
    setToken(data.token);
    setAdminId(data.admin?.id || credentials.id);
    // The route effect resolves the saved event after the account workspace has loaded.
  };
  const mutate = async (action, payload, success) => {
    if (readOnly) return alert('보관된 행사입니다. 프로젝트 관리에서 보관을 해제해주세요.');
    if (!selectedProject?.id) return alert('프로젝트를 먼저 선택해주세요.');
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (['resetDefaults', 'upsertDefaults', 'replaceProducts', 'replaceBundles', 'clearSales', 'updateProductImage', 'removeProduct', 'reorderProducts'].includes(action)) {
        const waiting = await orderRepository.countWaiting(selectedProject.id);
        if (waiting > 0) throw new Error('미동기화 주문이 남아 있습니다. 주문 동기화를 완료한 뒤 상품·세트 변경을 다시 시도해주세요.');
      }
      if (action === 'updateProductImage' && (await Promise.all(projects.map(project => orderRepository.countWaiting(project.id)))).some(Boolean)) throw new Error('공통 상품 수정 전 모든 행사의 미동기화 주문을 먼저 동기화해주세요.');
      if (activeScope.current !== scope) return false;
      const queueVersion = await stateRepository.queueVersion(selectedProject.id);
      const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ projectId: selectedProject.id, dataRevision, action, payload }) });
      if (activeScope.current !== scope) return;
      await eventReads.invalidate();
      await applyState(data, false, queueVersion);
      if (action === 'removeProduct') setCart(current => current.filter(line => line.type === 'product' ? line.id !== payload.productId : !(line.subItems || []).some(item => item.productId === payload.productId)));
      success?.(data);
      return true;
    } catch (err) {
      alert(err.message);
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const inventoryApi = async (action, payload = {}) => {
    if (!navigator.onLine) throw new Error('상품·재고는 인터넷 연결이 필요합니다.');
    if (action === 'getEventState') {
      const queueVersion = await stateRepository.queueVersion(payload.projectId);
      const data = await requestJson(`/api/pos?projectId=${encodeURIComponent(payload.projectId)}`,{background:payload.background===true});
      if (payload.apply && activeScope.current === scope && payload.projectId === selectedProject?.id) await applyState(data, false, queueVersion);
      return data;
    }
    if (['saveInventory','saveEventProduct','importInventory','recordStockMovement'].includes(action) && (await Promise.all(projects.map(project => orderRepository.countWaiting(project.id)))).some(Boolean)) throw new Error('공통 상품 수정 전 모든 행사의 미동기화 주문을 먼저 동기화해주세요.');
    if (['transferInventory', 'createEventProduct'].includes(action) && await orderRepository.countWaiting(payload.projectId)) throw new Error('이 행사의 미동기화 주문을 먼저 동기화해주세요.');
    if (action === 'createEventProduct' && readOnly) throw new Error('보관된 행사에는 상품을 등록할 수 없습니다.');
    const queueVersionBefore = ['createEventProduct','transferInventory','saveEventProduct','saveInventory','recordStockMovement','importInventory'].includes(action) && selectedProject?.id ? await stateRepository.queueVersion(selectedProject.id) : null;
    if (activeScope.current !== scope) throw new Error('화면이 변경되었습니다. 다시 시도해주세요.');
    const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ action, payload }) });
    await eventReads.invalidate();
    if (['createEventProduct','saveEventProduct'].includes(action) && activeScope.current === scope && payload.projectId === selectedProject?.id) await applyState(data, false, queueVersionBefore);
    if ((['saveInventory','recordStockMovement','importInventory'].includes(action) || (action === 'transferInventory' && payload.projectId === selectedProject?.id)) && selectedProject?.id && activeScope.current === scope) {
      setCart([]);
      const state = await requestJson(`/api/pos?projectId=${encodeURIComponent(selectedProject.id)}&boothId=${encodeURIComponent(selectedProject.boothId||'')}`);
      if (activeScope.current === scope) await applyState(state, false, queueVersionBefore);
    }
    return data;
  };

  const sharedStockContext=useRef(null);
  sharedStockContext.current={projects,selectedProject,scope,applyState};
  const readDashboardWaiting=useCallback(async projectId=>{
    const orders=await orderRepository.getAll(projectId);
    return countDashboardWaiting(orders,adminId,projectId);
  },[adminId]);
  const sharedStockRequest=useCallback(async(url,options)=>{
    if(!options||options.method!=='POST')return requestJson(url,options);
    if(!navigator.onLine)throw new Error('제작자 재고 변경은 인터넷 연결이 필요합니다.');
    const {payload={}}=JSON.parse(options.body);
    const before=sharedStockContext.current;
    const projectIds=[...new Set([...before.projects.map(p=>p.id),...(payload.allocations||[]).map(a=>a.projectId),payload.projectId,payload.currentProjectId,payload.fromProjectId].filter(Boolean))];
    if((await Promise.all(projectIds.map(id=>orderRepository.countWaiting(id)))).some(Boolean))throw Object.assign(new Error('미동기화 주문을 먼저 동기화해주세요.'),{status:409});
    if(activeToken.current!==token)throw Object.assign(new Error('로그인 계정이 변경되었습니다.'),{status:403});
    const queueVersion=before.selectedProject?await stateRepository.queueVersion(before.selectedProject.id):null;
    if(activeToken.current!==token)throw Object.assign(new Error('로그인 계정이 변경되었습니다.'),{status:403});
    const data=await requestJson(url,options);
    if(activeToken.current!==token)return data;
    if(before.selectedProject&&(before.selectedProject.permissions?.canSell||before.selectedProject.permissions?.canConfigure)&&activeScope.current===before.scope){
      const state=await requestJson(`/api/pos?projectId=${encodeURIComponent(before.selectedProject.id)}`);
      if(activeScope.current===before.scope){await before.applyState(state,false,queueVersion);setCart([]);}
    }
    if(typeof BroadcastChannel!=='undefined'){
      const channel=new BroadcastChannel('pos-project-lifecycle');
      channel.postMessage({action:'sharedStockChanged',projectIds:[...new Set([payload.projectId,payload.currentProjectId,payload.fromProjectId,...(data.inventory?.allocations||[]).map(a=>a.projectId)].filter(Boolean))]});channel.close();
    }
    return data;
  },[token]);

  const eventStockRequest=useMemo(()=>{
    const request=async(url,options)=>{
      if(String(options?.method||'GET').toUpperCase()==='GET')return eventReads.request(url,options);
      let result;
      try{result=await sharedStockRequest(url,options);}catch(error){
        if([401,403,404,409].includes(error.status))await eventReads.invalidate();
        throw error;
      }
      await eventReads.invalidate();
      return result;
    };
    request.subscribe=eventReads.request.subscribe;
    return request;
  },[eventReads,sharedStockRequest]);

  const persistProducts = (next) => mutate('replaceProducts', { products: next });
  const persistBundles = (next) => mutate('replaceBundles', { bundles: next });

  const reservedQty = (productId, targetCart = cart) => targetCart.reduce((sum, line) => {
    if (line.type === 'product' && line.id === productId) return sum + line.qty;
    if (line.type === 'bundle') return sum + line.subItems.reduce((s, item) => s + (item.productId === productId ? item.qty * line.qty : 0), 0);
    return sum;
  }, 0);
  const availableStock = (product, targetCart = cart) => Math.max(0, Number(product?.stock ?? product?.stockQty ?? 0) - reservedQty(product?.id, targetCart));
  const bundleAvailable = (bundle, targetCart = cart) => {
    if (!bundle?.items?.length) return 0;
    return bundle.items.reduce((min, item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return 0;
      return Math.min(min, Math.floor(availableStock(product, targetCart) / item.qty));
    }, Infinity);
  };
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);

  const addProduct = (product) => {
    if (readOnly) return;
    if (availableStock(product) <= 0) return;
    setCart((prev) => {
      const line = prev.find((l) => l.type === 'product' && l.id === product.id);
      return line ? prev.map((l) => (l === line ? { ...l, qty: l.qty + 1 } : l)) : [...prev, { type: 'product', id: product.id, name: product.name, unitPrice: product.price, qty: 1 }];
    });
  };
  const addBundle = (bundle) => {
    if (readOnly) return;
    if (bundleAvailable(bundle) <= 0) return;
    setCart((prev) => {
      const line = prev.find((l) => l.type === 'bundle' && l.id === bundle.id);
      return line ? prev.map((l) => (l === line ? { ...l, qty: l.qty + 1 } : l)) : [...prev, { type: 'bundle', id: bundle.id, name: bundle.name, unitPrice: bundle.price, qty: 1, subItems: bundle.items }];
    });
  };
  const updateCartQty = (index, diff) => {
    setCart((prev) => {
      const next = [...prev];
      const line = next[index];
      if (!line) return prev;
      if (diff > 0) {
        if (line.type === 'product') {
          const product = products.find((p) => p.id === line.id);
          if (availableStock(product, prev) <= 0) return prev;
        } else if (bundleAvailable(bundles.find((b) => b.id === line.id), prev) <= 0) return prev;
      }
      const qty = line.qty + diff;
      if (qty <= 0) return next.filter((_, i) => i !== index);
      next[index] = { ...line, qty };
      return next;
    });
  };
  const productsAfterSale = (sourceProducts, saleCart) => {
    const soldByProduct = new Map();
    for (const line of saleCart) {
      if (line.type === 'product') soldByProduct.set(line.id, (soldByProduct.get(line.id) || 0) + Number(line.qty || 0));
      if (line.type === 'bundle') {
        for (const item of line.subItems || []) {
          soldByProduct.set(item.productId, (soldByProduct.get(item.productId) || 0) + Number(item.qty || 0) * Number(line.qty || 0));
        }
      }
    }

    return sourceProducts.map((product) => ({
      ...product,
      stock: Math.max(0, Number(product.stock || 0) - Number(soldByProduct.get(product.id) || 0)),
      stockQty: Math.max(0, Number(product.stockQty ?? product.stock ?? 0) - Number(soldByProduct.get(product.id) || 0)),
    }));
  };
  const productsAfterVoidSale = (sourceProducts, sale) => {
    const restoredByProduct = new Map();
    for (const line of sale.lines || []) {
      if (line.type === 'product') restoredByProduct.set(line.id, (restoredByProduct.get(line.id) || 0) + Number(line.qty || 0));
      if (line.type === 'bundle') {
        const bundle = bundles.find((b) => b.id === line.id);
        for (const item of line.subItems || bundle?.items || []) {
          restoredByProduct.set(item.productId, (restoredByProduct.get(item.productId) || 0) + Number(item.qty || 0) * Number(line.qty || 0));
        }
      }
    }

    return sourceProducts.map((product) => ({
      ...product,
      stock: Number(product.stock || 0) + Number(restoredByProduct.get(product.id) || 0),
      stockQty: Number(product.stockQty ?? product.stock ?? 0) + Number(restoredByProduct.get(product.id) || 0),
    }));
  };
  const refreshAndSyncOrders = async () => {
    try {
      await sync.refreshPendingCount();
    } catch (err) {
      console.warn('[sync] failed to refresh pending order count', err);
    }
  };
  const finalizeSale = async (method) => {
    if (readOnly) return alert('보관된 행사에서는 판매할 수 없습니다.');
    if (!selectedProject?.id) return alert('프로젝트를 먼저 선택해주세요.');
    if (!cart.length || saving) return;
    setSaving(true);
    setError('');
    try {
      if (!['cash', 'transfer'].includes(method) || !Number.isSafeInteger(total) || total < 0 || total > 2147483647 || cart.some(line => !Number.isSafeInteger(line.qty) || line.qty <= 0 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0)) throw new Error('판매 수량과 0원 이상의 정수 가격을 확인해주세요.');
      const localOrderId = createLocalOrderId();
      const createdAt = new Date().toISOString();
      const attribution = product => product?.recipientId ? { ownerId:product.ownerId,recipientId:product.recipientId,settlementCreator:product.settlementCreator } : {};
      const saleCart = cart.map((line) => ({ ...line,
        ...(line.type === 'product' ? { creatorName: creatorNameOf(products.find(p => p.id === line.id)), ...attribution(products.find(p => p.id === line.id)) } : {
          subItems: line.subItems.map(item => {
            const product = products.find(p => p.id === item.productId);
            return { ...item, name: productNameWithoutCreator(product), creatorName: creatorNameOf(product), unitPrice: product?.price || 0, ...attribution(product) };
          }),
        }),
      }));
      const nextProducts = productsAfterSale(products, saleCart);
      const nextSales = [...sales, { id: localOrderId, time: createdAt, method, total, lines: saleCart }];
      const orderPayload = { localOrderId, createdAt, method, total, cart: saleCart };
      const apiPayload = { protocolVersion: 2, actorId: adminId, boothId: selectedProject.boothId || undefined, projectId: selectedProject.id, dataRevision, action: 'finalizeSale', payload: orderPayload };

      await stateRepository.commitOrder(selectedProject.id, {
        projectId: selectedProject.id,
        actorId: adminId, boothId: selectedProject.boothId || null,
        localOrderId,
        createdAt,
        payload: apiPayload,
        syncStatus: 'PENDING',
        retryCount: 0,
        lastSyncAt: null,
      }, { products, bundles, sales, dataRevision }, { products: nextProducts, bundles, sales: nextSales, dataRevision, archivedAt: selectedProject.archivedAt || null });
      if (activeScope.current !== scope) return;
      setProducts(nextProducts);
      setSales(nextSales);
      setCart([]);
      setPaymentToast({message:`${method === 'cash' ? '현금' : '계좌이체'} 결제가 완료되었습니다. ${won(total)}원`});
      void refreshAndSyncOrders();
    } catch (err) {
      alert(err.message || '로컬 주문 저장에 실패했습니다.');
      setError(err.message || '로컬 주문 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };
  const addBundleToSettings = async () => {
    const price = Number(bundlePrice);
    const items = bundleRows.filter((r) => r.productId).map((r) => ({ productId: r.productId, qty: Number(r.qty) }));
    if (!bundleName.trim() || String(bundlePrice).trim() === '' || !Number.isInteger(price) || price < 0 || !items.length || items.some((item) => !Number.isInteger(item.qty) || item.qty <= 0)) return alert('세트 이름, 0원 이상의 정수 판매가, 구성품과 양의 정수 수량을 입력해주세요.');
    const saved = await persistBundles([...bundles, { id: uid(), name: bundleName.trim(), price, items }]);
    if (!saved) return;
    clearRegistration();
    setBundleName(''); setBundlePrice(''); setBundleRows([{ productId: '', qty: 1 }]);
    setSettingsTab('bundles');
    setScreen('settings');
  };
  const exportCsv = () => {
    const rows = sales.map((sale) => `"${new Date(sale.time).toLocaleString('ko-KR')}","${sale.method === 'cash' ? '현금' : '계좌이체'}","${sale.lines.map((l) => `${l.name} x${l.qty}`).join(' / ')}",${sale.total}`);
    const blob = new Blob([`\uFEFF시간,결제수단,구성,금액\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `sales_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  const downloadBlob = (content, type, filename) => {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const voidSale = async (sale) => {
    if (readOnly) return alert('보관된 행사에서는 거래를 취소할 수 없습니다.');
    if (saving || !selectedProject?.id) return;
    if (!confirm('이 거래를 취소하고 재고를 복구할까요?')) return;
    setSaving(true);
    setError('');
    try {
      const nextProducts = productsAfterVoidSale(products, sale);
      const nextSales = sales.filter((item) => item.id !== sale.id);
      const createdAt = new Date().toISOString();
      await stateRepository.commitOrder(selectedProject.id, {
        projectId: selectedProject.id,
        actorId: adminId, boothId: selectedProject.boothId || null,
        localOrderId: `void_${sale.id}`,
        createdAt,
        payload: { protocolVersion: 2, actorId: adminId, boothId: selectedProject.boothId || undefined, projectId: selectedProject.id, dataRevision, action: 'voidSale', payload: { id: sale.id } },
        syncStatus: 'PENDING', retryCount: 0, lastSyncAt: null,
      }, { products, bundles, sales, dataRevision }, { products: nextProducts, bundles, sales: nextSales, dataRevision, archivedAt: selectedProject.archivedAt || null });
      if (activeScope.current !== scope) return;
      setProducts(nextProducts);
      setSales(nextSales);
      void refreshAndSyncOrders();
    } catch (err) {
      alert(err.message || '판매 취소 처리에 실패했습니다.');
      setError(err.message || '판매 취소 처리에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };
  const clearSalesWithPassword = () => {
    const password = prompt('판매 내역을 초기화하려면 로그인 패스워드를 입력해주세요.');
    if (!password) return;
    if (!confirm('모든 판매 내역을 삭제할까요? (재고는 복구되지 않습니다)')) return;
    mutate('clearSales', { password });
  };

  const stats = {
    total: sales.reduce((s, x) => s + x.total, 0),
    cash: sales.filter((x) => x.method === 'cash').reduce((s, x) => s + x.total, 0),
    transfer: sales.filter((x) => x.method === 'transfer').reduce((s, x) => s + x.total, 0),
  };

  const creators = useMemo(() => [...new Set(products.map(eventCreatorNameOf))].sort((a, b) => a.localeCompare(b, 'ko-KR')), [products]);
  const productsById = useMemo(() => Object.fromEntries(products.map((product) => [product.id, product])), [products]);
  const saleLineCreators = useCallback((line) => {
    if (line.creatorName) return [line.creatorName];
    if (line.type === 'product') return [creatorNameOf(productsById[line.id])];
    if (line.type === 'bundle') {
      const bundle = bundles.find((b) => b.id === line.id);
      return [...new Set((line.subItems || bundle?.items || []).map((item) => item.creatorName || creatorNameOf(productsById[item.productId])))];
    }
    return ['미지정'];
  }, [bundles, productsById]);
  const saleLineProductEntries = useCallback(line => settlementEntries(line, productsById, bundles), [bundles, productsById]);
  const visibleProducts = useMemo(() => {
    const filtered = creatorFilter === 'all' ? products : products.filter((p) => eventCreatorNameOf(p) === creatorFilter);
    return [...filtered].sort(compareProductSaleNumber);
  }, [creatorFilter, products]);
  const bundleCreators = useCallback((bundle) => [...new Set((bundle?.items || []).map((item) => eventCreatorNameOf(productsById[item.productId])))], [productsById]);
  const visibleBundles = useMemo(() => {
    if (creatorFilter === 'all') return bundles;
    return bundles.filter((bundle) => bundleCreators(bundle).includes(creatorFilter));
  }, [bundleCreators, bundles, creatorFilter]);
  const visibleSales = useMemo(() => {
    return sales.slice().reverse();
  }, [sales]);
  const creatorSalesSummary = useMemo(() => {
    const summaryByCreator = new Map();
    for (const sale of sales) {
      for (const line of sale.lines || []) {
        for (const entry of saleLineProductEntries(line)) {
          const creator = entry.creator || '미지정';
          const creatorSummary = summaryByCreator.get(creator) || { creator, qty: 0, amount: 0, goods: new Map() };
          const productKey = entry.productId || entry.name;
          const goodsSummary = creatorSummary.goods.get(productKey) || { productId: productKey, name: entry.name, qty: 0, amount: 0 };
          goodsSummary.qty += entry.qty;
          goodsSummary.amount += entry.amount;
          creatorSummary.qty += entry.qty;
          creatorSummary.amount += entry.amount;
          creatorSummary.goods.set(productKey, goodsSummary);
          summaryByCreator.set(creator, creatorSummary);
        }
      }
    }
    return [...summaryByCreator.values()]
      .map((summary) => ({ ...summary, goods: [...summary.goods.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount || a.name.localeCompare(b.name, 'ko-KR')) }))
      .sort((a, b) => b.amount - a.amount || b.qty - a.qty || a.creator.localeCompare(b.creator, 'ko-KR'));
  }, [saleLineProductEntries, sales]);
  const selectedCreatorSummary = creatorSalesSummary.find((summary) => summary.creator === logCreatorFilter);

  // Use the accepted hash route without account, project or product identifiers.
  const analyticsPath = pagePaths[routePage] || '/dashboard';
  const analytics = import.meta.env.PROD && !isNative
    ? <Analytics route={analyticsPath} path={analyticsPath} /> : null;
  if (!token) return <>{analytics}<ToastHost/>{routePage === 'signup' ? <SignupPage onAuthenticate={login} navigate={setScreen} /> : <LoginPage onAuthenticate={login} navigate={setScreen} />}</>;
  return <div className="app-shell flex h-full flex-col bg-paper text-ink">
    {analytics}
    <ApiReadIndicator/>
    <PaymentToast notice={paymentToast} onDismiss={setPaymentToast}/>
    <ToastHost/>
    <AppHeader profileImage={profileImage} page={screen} navigate={setScreen} project={selectedProject} projects={projects} onSelectProject={selectProject} saving={saving} sync={sync} selectionDisabled={saving || loading || projectLoading} />
    {['dashboard','account','revenue'].includes(screen)&&<nav className="event-subnav inventory-management-nav menu-tabs" aria-label={screen==='dashboard'?'대시보드 하위 메뉴':'마이페이지 하위 메뉴'}>{(screen==='dashboard'?[['dashboard','대시보드']]:[['account','마이페이지'],['revenue','수익현황']]).map(([key,label])=><button key={key} type="button" aria-current={screen===key?'page':undefined} onClick={()=>setScreen(key)}>{label}</button>)}</nav>}
    {error && <div className="bg-danger px-4 py-2 text-sm text-white">{error}</div>}
    {(selectedProject?.archivedAt || selectedProject?.settlementClosedAt) && !['inventory', 'account', 'dashboard', 'revenue', 'artistStock'].includes(screen) && <div role="status" className="border-b border-line bg-amber-50 px-4 py-3 text-sm">{selectedProject?.settlementClosedAt?'정산 금액 확정 · 판매·취소·비용 수정이 잠겨 있습니다.':'보관된 행사 · 읽기 전용입니다.'} <button type="button" className="event-text-link" onClick={() => setScreen(selectedProject?.settlementClosedAt?'log':'projectArchive')}>{selectedProject?.settlementClosedAt?'정산 내역 →':'비밀번호로 보관 해제 →'}</button></div>}
    {loading || projectLoading || (linkedProjectId && selectedProject?.id !== linkedProjectId) || (selectedProject && readyScope !== scope && !error) ? <main className="page-content"><LoadingState /></main> : <>

    {screen === 'dashboard' && <PersonalOverview key={adminId} request={requestJson} dashboard events={projects} readWaitingOrders={readDashboardWaiting} />}
    {screen === 'revenue' && <PersonalOverview key={adminId} request={requestJson} />}
    {screen === 'inventory' && <PersonalInventory key={adminId} request={sharedStockRequest} routeHash={routeHash} navigate={setScreen} />}
    {screen === 'invite' && <EventInvitePage key={routeParams.get('code') || ''} request={requestJson} code={routeParams.get('code') || ''} onClose={() => setScreen('projects')} onAccepted={async () => { await loadProjects({ background: true }); setScreen('projects'); }} />}
    {screen === 'artistStock' &&<ArtistStockPage key={adminId} request={sharedStockRequest} initialProjectId={selectedProject?.id} />}
    {screen === 'account' && <AccountPage adminId={adminId} request={requestJson} logout={logout} onProfileImage={setProfileImage} beforeDelete={async () => { if (loading || projectLoading || saving || !navigator.onLine) throw new Error('온라인에서 행사 목록을 모두 불러온 뒤 다시 시도해주세요.'); const fresh = await requestJson('/api/pos'); if ((await Promise.all(fresh.projects.map(project => orderRepository.countWaiting(project.id)))).some(Boolean)) throw new Error('모든 행사의 미동기화 주문을 먼저 동기화해주세요.'); }} />}
    {['projects', 'projectNew','projectDuplicate'].includes(screen) && <ProjectsPage creating={screen !== 'projects'} booths={workspace.booths} projects={projects} selectedProject={selectedProject} newProjectName={newProjectName} setNewProjectName={setNewProjectName} onCreateProject={createProject} onManageProject={manageProject} onSelectProject={selectProject} navigate={setScreen} />}

    {projectPages.includes(screen) && <ProjectManagementPage key={`${selectedProject.id}:${screen}`} page={screen} project={selectedProject} request={eventReads.request} beforeAccessChange={async action=>{if(['removeEventArtist','unlinkEventArtistAccount'].includes(action)){const ids=action==='unlinkEventArtistAccount'?[...new Set([selectedProject.id,...projects.map(p=>p.id)])]:[selectedProject.id];if((await Promise.all(ids.map(id=>orderRepository.countWaiting(id)))).some(Boolean))throw Object.assign(new Error('미동기화 주문을 먼저 처리해주세요.'),{status:409});}}} onAccessChange={async (action,result)=>{if(action==='unlinkEventArtistAccount')await loadProjects({background:true});await inventoryApi('getEventState',{projectId:selectedProject.id,apply:true,background:action==='saveEventAccess'});if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('pos-project-lifecycle');channel.postMessage(action==='unlinkEventArtistAccount'?{action:'creatorAccountChanged'}:{action:'sharedStockChanged',projectIds:result?.projectIds||[selectedProject.id]});channel.close();}}} onSettlementChange={async () => {const data=await inventoryApi('getEventState',{projectId:selectedProject.id,apply:true});if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('pos-project-lifecycle');channel.postMessage({action:'settlementChanged',adminId,projectId:selectedProject.id,closedAt:data.settlementClosedAt});channel.close();}}} summary={{ products: products.length, bundles: bundles.length, sales: sales.length, total: stats.total }} navigate={setScreen} onManageProject={manageProject} onSelectProject={selectProject} />}


    {screen === 'restore' && <ProjectRestorePage key={selectedProject?.id || 'standalone'} booths={workspace.booths} navigate={setScreen} onManageProject={manageProject} onSelectProject={selectProject} />}

    {screen === 'pos' && <SalesPage project={selectedProject} readOnly={readOnly} purchaseTab={purchaseTab} setPurchaseTab={setPurchaseTab} visibleProducts={visibleProducts} visibleBundles={visibleBundles} creators={creators} creatorFilter={creatorFilter} setCreatorFilter={setCreatorFilter} availableStock={availableStock} bundleAvailable={bundleAvailable} addProduct={addProduct} addBundle={addBundle} cart={cart} setCart={setCart} orderExpanded={orderExpanded} setOrderExpanded={setOrderExpanded} total={total} updateCartQty={updateCartQty} saving={saving} finalizeSale={finalizeSale} />}

    {screen==='settings'&&selectedProject.permissions?.canConfigure&&<div className="event-settings-tabs"><PageIntro hideTitle title="상품 관리"><PageTabs id="event-settings" label="상품 관리 메뉴" tabs={[["products","상품 관리"],["bundles","세트 관리"]]} selected={settingsTab} onSelect={setSettingsTab}/></PageIntro></div>}
    {(screen==='productNew'||screen==='settings'&&settingsTab!=='bundles')&&<PersonalInventory key={`${adminId}:${selectedProject.id}`} request={eventStockRequest} routeHash={routeHash} navigate={setScreen} event={selectedProject} eventProducts={products} eventSales={sales} onRemoveEventProduct={id=>mutate('removeProduct',{productId:id})}/>}
    {(screen==='bundleNew'||screen==='settings'&&settingsTab==='bundles')&&selectedProject.permissions?.canConfigure && <ProductsPage adminId={adminId} inventoryApi={inventoryApi} dataRevision={dataRevision} projectName={selectedProject.name} initialProductId={routeProductId} registerProduct={product => inventoryApi('createEventProduct', { projectId: selectedProject.id, dataRevision, product })} creatingProduct={screen === 'productNew'} creatingBundle={screen === 'bundleNew'} navigate={async (page, tab = 'bundles') => { if (!await allowNavigation()) return; setSettingsTab(tab); await setScreen(page); }} readOnly={readOnly} key={selectedProject.id} projectId={selectedProject.id} settingsTab={settingsTab} setSettingsTab={setSettingsTab} saving={saving} mutate={mutate} products={products} bundles={bundles} sales={sales} persistProducts={persistProducts} persistBundles={persistBundles} bundleName={bundleName} setBundleName={setBundleName} bundleRows={bundleRows} setBundleRows={setBundleRows} bundlePrice={bundlePrice} setBundlePrice={setBundlePrice} addBundleToSettings={addBundleToSettings} />}

    {screen==='log'&&selectedProject&&!selectedProject.permissions?.canSettle&&<PersonalOverview request={eventReads.request} projectId={selectedProject.id}/>}
    {screen === 'log' && selectedProject?.permissions?.canSettle && <SettlementPage key={`${screen}:${selectedProject.id}:${routeParams.get('productId') || ''}`} initialProductId={linkedProjectId ? routeParams.get('productId') || '' : ''} initialProductSearch={linkedProjectId ? routeParams.get('productName') || '' : ''} reportOnly={screen === 'revenue'} initialTab={screen === 'log' && routeParams.get('productId') ? 'history' : 'summary'} request={eventReads.request} projectId={selectedProject.id} products={products} bundles={bundles} onSettlementChange={async () => {const data=await inventoryApi('getEventState',{projectId:selectedProject.id,apply:true});if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('pos-project-lifecycle');channel.postMessage({action:'settlementChanged',adminId,projectId:selectedProject.id,closedAt:data.settlementClosedAt});channel.close();}}} readOnly={readOnly} stats={stats} sales={sales} visibleSales={visibleSales} logCreatorFilter={logCreatorFilter} setLogCreatorFilter={setLogCreatorFilter} creatorSalesSummary={creatorSalesSummary} selectedCreatorSummary={selectedCreatorSummary} exportCsv={exportCsv} clearSalesWithPassword={clearSalesWithPassword} saleLineCreators={saleLineCreators} saleLineProductEntries={saleLineProductEntries} voidSale={voidSale} />}
    </>}

  </div>;
}
