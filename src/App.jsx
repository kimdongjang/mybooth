import InventoryPage from './pages/InventoryPage';
import GettingStarted from './components/GettingStarted';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import SalesPage from './pages/SalesPage';
import ProductsPage from './pages/ProductsPage';
import SettlementPage from './pages/SettlementPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectManagementPage from './pages/ProjectManagementPage';
import ProjectRestorePage from './pages/ProjectRestorePage';
import { AppHeader } from './components/PageLayout';
import { Input } from './components/PosUI';
import { pagePaths, pageTitles, projectPages, pageForHash, usePageRoute } from './hooks/usePageRoute';
import { uid, won, creatorNameOf, productNameFromFields, productNameWithoutCreator, normalizeProductForClient } from './utils/productDisplay';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { orderRepository } from './database/orderRepository';
import { stateRepository } from './database/stateRepository';
import { useSync } from './hooks/useSync';
import { createLocalOrderId } from './utils/orderId';

const AUTH_TOKEN_KEY = 'pos_admin_token';
const AUTH_ADMIN_KEY = 'pos_admin_id';
const SELECTED_PROJECT_KEY = 'pos_selected_project_id';

async function requestJson(url, options = {}) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '요청 처리에 실패했습니다.'), { status: res.status });
  return data;
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(AUTH_TOKEN_KEY));
  const [adminId, setAdminId] = useState(() => sessionStorage.getItem(AUTH_ADMIN_KEY) || '');
  const [loading, setLoading] = useState(Boolean(token));
  const [projectLoading, setProjectLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [dataRevision, setDataRevision] = useState(null);
  const readOnly = Boolean(selectedProject?.archivedAt);
  const [readyScope, setReadyScope] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [routePage, setScreen, routeHash] = usePageRoute();
  const historyParams = new URLSearchParams(routeHash.split('?')[1] || '');
  const historyProjectId = routePage === 'log' ? historyParams.get('projectId') : null;
  const screen = selectedProject || historyProjectId || ['restore', 'projectNew', 'inventory', 'account'].includes(routePage) ? routePage : 'projects';
  const [orderExpanded, setOrderExpanded] = useState(false);


  useEffect(() => { setOrderExpanded(false); }, [screen, selectedProject?.id]);
  useEffect(() => {
    if (!token) {
      if (!['login', 'signup'].includes(routePage)) setScreen('login', true);
      document.title = `${routePage === 'signup' ? '회원가입' : '로그인'} · 마이 부스`;
      return;
    }
    if (loading || projectLoading) return;
    if (['login', 'signup'].includes(routePage)) { setScreen(selectedProject ? 'pos' : 'projects', true); return; }
    if (selectedProject && ['projects', 'projectNew'].includes(routePage)) { setScreen('pos', true); return; }
    if (!selectedProject && !historyProjectId && !['projects', 'projectNew', 'restore', 'inventory', 'account'].includes(routePage)) setScreen('projects', true);
    else if (!pageForHash(routeHash)) setScreen(screen, true);
    document.title = `${pageTitles[screen]} · 마이 부스`;
    document.querySelector('.page-heading h1')?.focus();
  }, [screen, routePage, routeHash, token, loading, projectLoading, selectedProject?.id, setScreen]);
  const [settingsTab, setSettingsTab] = useState('products');
  useEffect(() => { if (screen === 'bundleNew') setSettingsTab('bundles'); else if (screen === 'productNew') setSettingsTab('products'); }, [screen, selectedProject?.id]);
  const [products, setProducts] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [sales, setSales] = useState([]);
  const [cart, setCart] = useState([]);
  const [bundleRows, setBundleRows] = useState([{ productId: '', qty: 1 }]);
  const [bundleName, setBundleName] = useState('');
  const [bundlePrice, setBundlePrice] = useState('');
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
  const scope = `${token || ''}:${selectedProject?.id || ''}`;
  activeScope.current = scope;
  const activeToken = useRef(token);
  activeToken.current = token;
  const getAuthToken = useCallback(() => token, [token]);
  useEffect(() => {
    if (!token || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('pos-project-lifecycle');
    channel.onmessage = ({ data }) => {
      if (data.adminId !== adminId || !data.projectId || !['archiveProject', 'unarchiveProject'].includes(data.action)) return;
      setProjects(current => current.map(project => project.id === data.projectId ? { ...project, archivedAt: data.archivedAt } : project));
      setSelectedProject(current => current?.id === data.projectId ? { ...current, archivedAt: data.archivedAt } : current);
      if (selectedProject?.id === data.projectId) setCart([]);
      void stateRepository.setArchivedAt(data.projectId, data.archivedAt);
    };
    return () => channel.close();
  }, [token, adminId, selectedProject?.id]);
  const sync = useSync({ enabled: Boolean(token && selectedProject?.id && readyScope === scope && !readOnly), getAuthToken, projectId: selectedProject?.id });

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
    setSelectedProject(current => current?.id === selectedProject.id ? { ...current, archivedAt: nextArchivedAt } : current);
    if (nextArchivedAt) setCart([]);
    setReadyScope(scope);
  };

  const logout = () => {
    setScreen('login', true);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_ADMIN_KEY);
    sessionStorage.removeItem(SELECTED_PROJECT_KEY);
    setToken(null);
    setAdminId('');
    setProjects([]);
    setSelectedProject(null);
    setProducts([]);
    setBundles([]);
    setSales([]);
    setCart([]);
  };

  const loadState = async () => {
    if (!selectedProject?.id) return;
    setLoading(true);
    setError('');
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = await stateRepository.get(selectedProject.id);
        if (activeScope.current !== scope) return;
        if (cached && (!['pxwiu2t', 's4fjgga'].includes(selectedProject.id) || cached.dataRevision)) {
          await applyState(cached, true);
          setError('오프라인 상태입니다. 마지막 저장 데이터를 사용합니다.');
          return;
        }
        setError('오프라인 상태입니다. 저장된 데이터가 없어 상품을 불러올 수 없습니다.');
        return;
      }

      const queueVersion = await stateRepository.queueVersion(selectedProject.id);
      const data = await requestJson(`/api/pos?projectId=${encodeURIComponent(selectedProject.id)}`);
      if (activeScope.current !== scope) return;
      // Preserve the durable local projection until every command is acknowledged.
      if (await orderRepository.countWaiting(selectedProject.id)) {
        const cached = await stateRepository.get(selectedProject.id);
        if (!cached) throw new Error('미전송 주문의 로컬 상태를 찾을 수 없습니다. 주문 백업을 보존하고 복구해주세요.');
        await applyState(cached, true);
        setError('미동기화 주문을 보존했습니다. 동기화 완료 후 새로고침하면 서버 변경을 불러옵니다.');
      } else await applyState(data, false, queueVersion);
    } catch (err) {
      if (activeToken.current !== token) return;
      if (String(err.message).includes('인증')) logout();
      else {
        const cached = await stateRepository.get(selectedProject.id);
        if (activeScope.current !== scope) return;
        if (cached && (!['pxwiu2t', 's4fjgga'].includes(selectedProject.id) || cached.dataRevision)) {
          await applyState(cached, true);
          setError('오프라인 상태입니다. 마지막 저장 데이터를 사용합니다.');
        } else setError(err.message);
      }
    } finally {
      if (activeScope.current === scope) setLoading(false);
    }
  };

  const loadProjects = async () => {
    if (!token) return;
    setProjectLoading(true);
    setError('');
    try {
      const data = await requestJson('/api/pos');
      if (activeToken.current !== token) return;
      const nextProjects = data.projects || [];
      setProjects(nextProjects);
      const rememberedId = sessionStorage.getItem(SELECTED_PROJECT_KEY);
      const remembered = nextProjects.find((project) => project.id === rememberedId);
      setSelectedProject((current) => nextProjects.find((project) => project.id === current?.id) || remembered || null);
    } catch (err) {
      if (activeToken.current !== token) return;
      if (String(err.message).includes('인증')) logout();
      else setError(err.message);
    } finally {
      setProjectLoading(false);
      setLoading(false);
    }
  };

  const createProject = async (e) => {
    e?.preventDefault();
    if (!newProjectName.trim()) return alert('프로젝트 이름을 입력해주세요.');
    setProjectLoading(true);
    setError('');
    try {
      const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ action: 'createProject', payload: { name: newProjectName.trim() } }) });
      const project = data.project;
      setNewProjectName('');
      await loadProjects();
      selectProject(project);
    } catch (err) {
      alert(err.message);
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
    const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ projectId: project?.id, action, payload }) });
    if (activeToken.current !== token) return;
    if (action === 'backupProject') {
      downloadBlob(JSON.stringify(data.backup), 'application/json;charset=utf-8;', `project_${project.id}_${new Date().toISOString().slice(0, 10)}.json`);
      return data;
    }
    setProjects(data.projects);
    if (action === 'deleteProject') {
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        sessionStorage.removeItem(SELECTED_PROJECT_KEY);
        setProducts([]); setBundles([]); setSales([]); setCart([]);
        setScreen('projects');
      }
      await stateRepository.remove(project.id);
    } else if (project) {
      setSelectedProject(current => current?.id === project.id ? data.projects.find(item => item.id === project.id) : current);
      if (['archiveProject', 'unarchiveProject'].includes(action)) {
        const value = data.projects.find(item => item.id === project.id)?.archivedAt || null;
        if (activeScope.current === scope && selectedProject?.id === project.id) setCart([]);
        await stateRepository.setArchivedAt(project.id, value);
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('pos-project-lifecycle');
          channel.postMessage({ adminId, projectId: project.id, action, archivedAt: value });
          channel.close();
        }
      }
    }
    return { ...data, project: data.projects?.find(item => item.id === data.project?.id) || data.project };
  };

  const releaseProject = () => {
    if (saving || loading || projectLoading) return;
    activeScope.current = `${token || ''}:`;
    sessionStorage.removeItem(SELECTED_PROJECT_KEY);
    setSelectedProject(null);
    setReadyScope(null);
    setDataRevision(null);
    setProducts([]); setBundles([]); setSales([]); setCart([]);
    setError('');
    setScreen('projects');
  };

  const selectProject = (project, options = {}) => {
    if (selectedProject && selectedProject.id !== project.id && !options.fromInventory) { setScreen('pos'); return; }
    if (project.id === selectedProject?.id) { setScreen(options.destination || 'pos'); return; }
    setError('');
    setSelectedProject(project);
    sessionStorage.setItem(SELECTED_PROJECT_KEY, project.id);
    setProducts([]);
    setBundles([]);
    setSales([]);
    setCart([]);
    setScreen(options.destination || 'pos');
  };

  useEffect(() => {
    if (!token || projectLoading || !historyProjectId) return;
    const target = projects.find(project => project.id === historyProjectId);
    if (!target) { setError('행사를 찾을 수 없거나 접근 권한이 없습니다.'); setScreen('inventory', true); return; }
    if (selectedProject?.id !== target.id) selectProject(target, { fromInventory: true, destination: routeHash.slice(1) });
  }, [token, projectLoading, historyProjectId, projects, selectedProject?.id]);

  useEffect(() => { if (token) loadProjects(); }, [token]);
  useEffect(() => { if (token && selectedProject?.id) loadState(); }, [token, selectedProject?.id]);

  const login = async (credentials) => {
    const data = await requestJson('/api/auth', { method: 'POST', body: JSON.stringify(credentials) });
    sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
    sessionStorage.setItem(AUTH_ADMIN_KEY, data.admin?.id || credentials.id);
    setToken(data.token);
    setAdminId(data.admin?.id || credentials.id);
    setScreen('pos', true);
  };
  const mutate = async (action, payload, success) => {
    if (readOnly) return alert('보관된 행사입니다. 프로젝트 관리에서 보관을 해제해주세요.');
    if (!selectedProject?.id) return alert('프로젝트를 먼저 선택해주세요.');
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (['resetDefaults', 'upsertDefaults', 'replaceProducts', 'replaceBundles', 'clearSales'].includes(action)) {
        const waiting = await orderRepository.countWaiting(selectedProject.id);
        if (waiting > 0) throw new Error('미동기화 주문이 남아 있습니다. 주문 동기화를 완료한 뒤 상품·세트 변경을 다시 시도해주세요.');
      }
      if (activeScope.current !== scope) return false;
      const queueVersion = await stateRepository.queueVersion(selectedProject.id);
      const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ projectId: selectedProject.id, dataRevision, action, payload }) });
      if (activeScope.current !== scope) return;
      await applyState(data, false, queueVersion);
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
    if (!navigator.onLine) throw new Error('재고 관리는 인터넷 연결이 필요합니다.');
    if (['transferInventory', 'createEventProduct'].includes(action) && await orderRepository.countWaiting(payload.projectId)) throw new Error('이 행사의 미동기화 주문을 먼저 동기화해주세요.');
    if (action === 'createEventProduct' && readOnly) throw new Error('보관된 행사에는 상품을 등록할 수 없습니다.');
    const queueVersionBefore = action === 'createEventProduct' ? await stateRepository.queueVersion(payload.projectId) : null;
    const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ action, payload }) });
    if (action === 'createEventProduct' && activeScope.current === scope && payload.projectId === selectedProject?.id) await applyState(data, false, queueVersionBefore);
    if (action === 'transferInventory' && payload.projectId === selectedProject?.id) {
      setCart([]);
      const queueVersion = await stateRepository.queueVersion(selectedProject.id);
      const state = await requestJson(`/api/pos?projectId=${encodeURIComponent(selectedProject.id)}`);
      if (activeScope.current === scope) await applyState(state, false, queueVersion);
    }
    return data;
  };

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
      void sync.syncNow();
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
      const saleCart = cart.map((line) => ({ ...line,
        ...(line.type === 'product' ? { creatorName: creatorNameOf(products.find(p => p.id === line.id)) } : {
          subItems: line.subItems.map(item => {
            const product = products.find(p => p.id === item.productId);
            return { ...item, name: productNameWithoutCreator(product), creatorName: creatorNameOf(product), unitPrice: product?.price || 0 };
          }),
        }),
      }));
      const nextProducts = productsAfterSale(products, saleCart);
      const nextSales = [...sales, { id: localOrderId, time: createdAt, method, total, lines: saleCart }];
      const orderPayload = { localOrderId, createdAt, method, total, cart: saleCart };
      const apiPayload = { projectId: selectedProject.id, dataRevision, action: 'finalizeSale', payload: orderPayload };

      await stateRepository.commitOrder(selectedProject.id, {
        projectId: selectedProject.id,
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
      alert(`${method === 'cash' ? '현금' : '계좌이체'} 결제가 완료되었습니다.\n결제 금액: ${won(total)}원`);
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
  const backupOrdersJson = async () => {
    const orders = await orderRepository.getAll(selectedProject.id);
    downloadBlob(JSON.stringify(orders, null, 2), 'application/json;charset=utf-8;', `orders_backup_${new Date().toISOString().slice(0, 10)}.json`);
  };
  const backupOrdersCsv = async () => {
    const orders = await orderRepository.getAll(selectedProject.id);
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = orders.map((order) => [
      order.id,
      order.localOrderId,
      order.createdAt,
      order.syncStatus,
      order.retryCount,
      order.lastSyncAt || '',
      JSON.stringify(order.payload),
    ].map(escapeCsv).join(','));
    downloadBlob(`\uFEFFid,localOrderId,createdAt,syncStatus,retryCount,lastSyncAt,payload\n${rows.join('\n')}`, 'text/csv;charset=utf-8;', `orders_backup_${new Date().toISOString().slice(0, 10)}.csv`);
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
        localOrderId: `void_${sale.id}`,
        createdAt,
        payload: { projectId: selectedProject.id, dataRevision, action: 'voidSale', payload: { id: sale.id } },
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

  const creators = useMemo(() => [...new Set(products.map(creatorNameOf))].sort((a, b) => a.localeCompare(b, 'ko-KR')), [products]);
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
  const saleLineProductEntries = useCallback((line) => {
    if (line.type === 'product') {
      const product = productsById[line.id];
      return [{
        productId: line.id,
        name: line.name || productNameWithoutCreator(product),
        creator: line.creatorName || creatorNameOf(product),
        qty: Number(line.qty || 0),
        amount: Number(line.unitPrice || 0) * Number(line.qty || 0),
      }];
    }
    if (line.type === 'bundle') {
      const bundle = bundles.find((b) => b.id === line.id);
      const items = line.subItems || bundle?.items || [];
      const lineQty = Number(line.qty || 0);
      const lineTotal = Number(line.unitPrice || 0) * lineQty;
      const weights = items.map((item) => {
        const product = productsById[item.productId];
        const itemQty = Number(item.qty || 0);
        return Math.max(0, Number(item.unitPrice ?? product?.price ?? 0) * itemQty) || itemQty;
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      return items.map((item, index) => {
        const product = productsById[item.productId];
        return {
          productId: item.productId,
          name: item.name || productNameWithoutCreator(product) || product?.name || '알 수 없는 굿즈',
          creator: item.creatorName || creatorNameOf(product),
          qty: Number(item.qty || 0) * lineQty,
          amount: lineTotal * (weights[index] / totalWeight),
        };
      });
    }
    return [];
  }, [bundles, productsById]);
  const visibleProducts = useMemo(() => {
    const filtered = creatorFilter === 'all' ? products : products.filter((p) => creatorNameOf(p) === creatorFilter);
    return [...filtered].sort((a, b) => (
      creatorNameOf(a).localeCompare(creatorNameOf(b), 'ko-KR') ||
      String(a.goodsType || a.name || '').localeCompare(String(b.goodsType || b.name || ''), 'ko-KR') ||
      String(a.vtuberName || '').localeCompare(String(b.vtuberName || ''), 'ko-KR') ||
      String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR')
    ));
  }, [creatorFilter, products]);
  const bundleCreators = useCallback((bundle) => [...new Set((bundle?.items || []).map((item) => creatorNameOf(productsById[item.productId])))], [productsById]);
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

  if (!token) return routePage === 'signup' ? <SignupPage onAuthenticate={login} navigate={setScreen} /> : <LoginPage onAuthenticate={login} navigate={setScreen} />;
  return <div className="app-shell flex h-full flex-col bg-paper text-ink">
    <GettingStarted key={token} scope={`${screen}:${selectedProject?.id || ""}`} />
    <AppHeader page={screen} navigate={setScreen} project={selectedProject} adminId={adminId} saving={saving} sync={sync} onReleaseProject={releaseProject} releaseDisabled={saving || loading || projectLoading} />
    {error && <div className="bg-danger px-4 py-2 text-sm text-white">{error}</div>}
    {readOnly && !['inventory', 'account'].includes(screen) && <div role="status" className="border-b border-line bg-amber-50 px-4 py-3 text-sm">보관된 행사 · 읽기 전용입니다. <button type="button" className="event-text-link" onClick={() => setScreen('projectArchive')}>비밀번호로 보관 해제 →</button></div>}
    {loading || projectLoading || (historyProjectId && selectedProject?.id !== historyProjectId) || (selectedProject && readyScope !== scope && !error) ? <main className="page-content flex items-center justify-center" role="status">데이터를 불러오는 중...</main> : <>

    {screen === 'inventory' && <InventoryPage key={adminId} adminId={adminId} api={inventoryApi} routeHash={routeHash} navigate={setScreen} />}
    {screen === 'account' && <main className="page-content"><h1>내 계정 정보</h1><section className="inventory-card"><p>아이디: <strong>{adminId}</strong></p><p>상품과 창고 재고는 이 계정에 저장되며, 행사별 판매·정산은 각각 보관됩니다.</p><button type="button" className="management-back" onClick={logout}>로그아웃</button></section></main>}
    {['projects', 'projectNew'].includes(screen) && <ProjectsPage creating={screen === 'projectNew'} projects={projects} selectedProject={selectedProject} newProjectName={newProjectName} setNewProjectName={setNewProjectName} onCreateProject={createProject} onSelectProject={selectProject} navigate={setScreen} />}

    {projectPages.includes(screen) && <ProjectManagementPage key={`${selectedProject.id}:${screen}`} page={screen} project={selectedProject} summary={{ products: products.length, bundles: bundles.length, sales: sales.length, total: stats.total }} navigate={setScreen} onManageProject={manageProject} onSelectProject={selectProject} />}

    {screen === 'restore' && <ProjectRestorePage key={selectedProject?.id || 'standalone'} project={selectedProject} navigate={setScreen} onManageProject={manageProject} onSelectProject={selectProject} />}

    {screen === 'pos' && <SalesPage project={selectedProject} readOnly={readOnly} purchaseTab={purchaseTab} setPurchaseTab={setPurchaseTab} visibleProducts={visibleProducts} visibleBundles={visibleBundles} creators={creators} creatorFilter={creatorFilter} setCreatorFilter={setCreatorFilter} availableStock={availableStock} bundleAvailable={bundleAvailable} addProduct={addProduct} addBundle={addBundle} cart={cart} setCart={setCart} orderExpanded={orderExpanded} setOrderExpanded={setOrderExpanded} total={total} updateCartQty={updateCartQty} saving={saving} finalizeSale={finalizeSale} />}

    {['settings', 'bundleNew', 'productNew'].includes(screen) && <ProductsPage registerProduct={product => inventoryApi('createEventProduct', { projectId: selectedProject.id, dataRevision, product })} creatingProduct={screen === 'productNew'} creatingBundle={screen === 'bundleNew'} navigate={(page, tab = 'bundles') => { setSettingsTab(tab); setScreen(page); }} readOnly={readOnly} key={selectedProject.id} projectId={selectedProject.id} settingsTab={settingsTab} setSettingsTab={setSettingsTab} saving={saving} mutate={mutate} products={products} bundles={bundles} sales={sales} persistProducts={persistProducts} persistBundles={persistBundles} bundleName={bundleName} setBundleName={setBundleName} bundleRows={bundleRows} setBundleRows={setBundleRows} bundlePrice={bundlePrice} setBundlePrice={setBundlePrice} addBundleToSettings={addBundleToSettings} backupOrdersJson={backupOrdersJson} backupOrdersCsv={backupOrdersCsv} />}

    {screen === 'log' && selectedProject && <SettlementPage key={`${selectedProject.id}:${historyParams.get('productId') || ''}`} initialProductId={historyProjectId ? historyParams.get('productId') || '' : ''} initialProductSearch={historyProjectId ? historyParams.get('productName') || '' : ''} initialTab={historyProjectId ? 'history' : 'summary'} readOnly={readOnly} stats={stats} sales={sales} visibleSales={visibleSales} logCreatorFilter={logCreatorFilter} setLogCreatorFilter={setLogCreatorFilter} creatorSalesSummary={creatorSalesSummary} selectedCreatorSummary={selectedCreatorSummary} exportCsv={exportCsv} clearSalesWithPassword={clearSalesWithPassword} saleLineCreators={saleLineCreators} saleLineProductEntries={saleLineProductEntries} voidSale={voidSale} />}
    </>}

  </div>;
}
