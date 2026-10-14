import SalesPage from './pages/SalesPage';
import ProductsPage from './pages/ProductsPage';
import SettlementPage from './pages/SettlementPage';
import ProjectsPage from './pages/ProjectsPage';
import { AppHeader } from './components/PageLayout';
import { Input } from './components/PosUI';
import { pagePaths, usePageRoute } from './hooks/usePageRoute';
import { uid, won, creatorNameOf, productNameFromFields, productNameWithoutCreator, normalizeProductForClient } from './utils/productDisplay';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { orderRepository } from './database/orderRepository';
import { stateRepository } from './database/stateRepository';
import { useSync } from './hooks/useSync';
import { createLocalOrderId } from './utils/orderId';

const AUTH_TOKEN_KEY = 'pos_admin_token';
const AUTH_ADMIN_KEY = 'pos_admin_id';
const SELECTED_PROJECT_KEY = 'pos_selected_project_id';
const CREATOR_COLOR_PALETTE = [
  { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' },
  { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' },
  { bg: '#dcfce7', text: '#166534', border: '#22c55e' },
  { bg: '#fce7f3', text: '#9d174d', border: '#ec4899' },
  { bg: '#ede9fe', text: '#5b21b6', border: '#8b5cf6' },
  { bg: '#cffafe', text: '#155e75', border: '#06b6d4' },
  { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' },
  { bg: '#e0e7ff', text: '#3730a3', border: '#6366f1' },
];

async function requestJson(url, options = {}) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 처리에 실패했습니다.');
  return data;
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(AUTH_TOKEN_KEY));
  const [adminId, setAdminId] = useState(() => sessionStorage.getItem(AUTH_ADMIN_KEY) || '');
  const [loginId, setLoginId] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(Boolean(token));
  const [projectLoading, setProjectLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [dataRevision, setDataRevision] = useState(null);
  const [readyScope, setReadyScope] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [routePage, setScreen] = usePageRoute();
  const screen = selectedProject ? routePage : 'projects';
  const [orderExpanded, setOrderExpanded] = useState(false);


  useEffect(() => { setOrderExpanded(false); }, [screen, selectedProject?.id]);
  useEffect(() => {
    if (!token || loading || projectLoading) return;
    if (!selectedProject && routePage !== 'projects') setScreen('projects', true);
    else if (!Object.values(pagePaths).some((path) => window.location.hash === `#${path}`)) setScreen(screen, true);
    document.title = `${{ pos: '상품 판매', settings: '상품 관리', log: '정산', projects: '프로젝트 변경' }[screen]} · 마이 부스`;
    document.querySelector('.page-heading h1')?.focus();
  }, [screen, routePage, token, loading, projectLoading, selectedProject?.id, setScreen]);
  const [settingsTab, setSettingsTab] = useState('products');
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
    setSettingsTab('products');
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
  const sync = useSync({ enabled: Boolean(token && selectedProject?.id && readyScope === scope), getAuthToken, projectId: selectedProject?.id });

  const persistLocalState = async (nextProducts = products, nextBundles = bundles, nextSales = sales) => {
    if (!selectedProject?.id) return;
    await stateRepository.save(selectedProject.id, { products: nextProducts, bundles: nextBundles, sales: nextSales, dataRevision });
  };

  const applyState = (data) => {
    if (activeScope.current !== scope) return;
    const nextProducts = (data.products || []).map(normalizeProductForClient);
    const nextBundles = data.bundles || [];
    const nextSales = data.sales || [];
    setProducts(nextProducts);
    setBundles(nextBundles);
    setSales(nextSales);
    setDataRevision(data.dataRevision || null);
    setReadyScope(scope);
    void stateRepository.save(selectedProject.id, { products: nextProducts, bundles: nextBundles, sales: nextSales, dataRevision: data.dataRevision || null });
  };

  const logout = () => {
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
          applyState(cached);
          setError('오프라인 상태입니다. 마지막 저장 데이터를 사용합니다.');
          return;
        }
        setError('오프라인 상태입니다. 저장된 데이터가 없어 상품을 불러올 수 없습니다.');
        return;
      }

      const data = await requestJson(`/api/pos?projectId=${encodeURIComponent(selectedProject.id)}`);
      if (activeScope.current !== scope) return;
      if (data.dataRevision) await orderRepository.archivePreviousRevision(selectedProject.id, data.dataRevision);
      applyState(data);
    } catch (err) {
      if (activeToken.current !== token) return;
      if (String(err.message).includes('인증')) logout();
      else {
        const cached = await stateRepository.get(selectedProject.id);
        if (activeScope.current !== scope) return;
        if (cached && (!['pxwiu2t', 's4fjgga'].includes(selectedProject.id) || cached.dataRevision)) {
          applyState(cached);
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
      setSelectedProject((current) => current && nextProjects.find((project) => project.id === current.id) ? current : remembered || null);
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

  const selectProject = (project) => {
    if (project.id === selectedProject?.id) { setScreen('pos'); return; }
    setError('');
    setSelectedProject(project);
    sessionStorage.setItem(SELECTED_PROJECT_KEY, project.id);
    setProducts([]);
    setBundles([]);
    setSales([]);
    setCart([]);
    setScreen('pos');
  };

  useEffect(() => { if (token) loadProjects(); }, [token]);
  useEffect(() => { if (token && selectedProject?.id) loadState(); }, [token, selectedProject?.id]);

  const login = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const data = await requestJson('/api/auth', { method: 'POST', body: JSON.stringify({ mode: authMode, id: loginId, password: loginPassword, ...(authMode === 'signup' ? { email: loginEmail } : {}) }) });
      sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
      sessionStorage.setItem(AUTH_ADMIN_KEY, data.admin?.id || loginId);
      setToken(data.token);
      setAdminId(data.admin?.id || loginId);
      setLoginPassword('');
      setLoginEmail('');
    } catch (err) {
      setLoginError(err.message);
    }
  };

  const mutate = async (action, payload, success) => {
    if (!selectedProject?.id) return alert('프로젝트를 먼저 선택해주세요.');
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (['resetDefaults', 'upsertDefaults', 'replaceProducts', 'replaceBundles'].includes(action)) {
        const waiting = await orderRepository.countWaiting(selectedProject.id);
        if (waiting > 0) throw new Error('미동기화 주문이 남아 있습니다. 주문 동기화를 완료한 뒤 상품·세트 변경을 다시 시도해주세요.');
      }
      if (activeScope.current !== scope) return false;
      const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ projectId: selectedProject.id, dataRevision, action, payload }) });
      if (activeScope.current !== scope) return;
      applyState(data);
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
    if (availableStock(product) <= 0) return;
    setCart((prev) => {
      const line = prev.find((l) => l.type === 'product' && l.id === product.id);
      return line ? prev.map((l) => (l === line ? { ...l, qty: l.qty + 1 } : l)) : [...prev, { type: 'product', id: product.id, name: product.name, unitPrice: product.price, qty: 1 }];
    });
  };
  const addBundle = (bundle) => {
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
        for (const item of bundle?.items || []) {
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
  const applyLocalSale = (saleCart) => {
    setProducts((prev) => productsAfterSale(prev, saleCart));
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
    if (!selectedProject?.id) return alert('프로젝트를 먼저 선택해주세요.');
    if (!cart.length || saving) return;
    setSaving(true);
    setError('');
    try {
      const localOrderId = createLocalOrderId();
      const createdAt = new Date().toISOString();
      const saleCart = cart.map((line) => ({ ...line }));
      const orderPayload = { localOrderId, createdAt, method, total, cart: saleCart };
      const apiPayload = { projectId: selectedProject.id, dataRevision, action: 'finalizeSale', payload: orderPayload };

      await orderRepository.add({
        projectId: selectedProject.id,
        localOrderId,
        createdAt,
        payload: apiPayload,
        syncStatus: 'PENDING',
        retryCount: 0,
        lastSyncAt: null,
      });

      const nextProducts = productsAfterSale(products, saleCart);
      const nextSales = [...sales, { id: localOrderId, time: createdAt, method, total, lines: saleCart.map(({ subItems, ...line }) => line) }];
      applyLocalSale(saleCart);
      setSales(nextSales);
      void persistLocalState(nextProducts, bundles, nextSales);
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
  const resetDefaults = () => {
    if (!confirm('현재 상품/세트 목록과 재고를 기본 44종으로 초기화할까요? 직접 추가·수정한 상품/세트는 제거됩니다. 판매 내역은 유지되지만, 과거 판매의 제작자 집계와 세트 취소 결과는 변경될 수 있습니다.')) return;
    mutate('resetDefaults', {}, () => setCart([]));
  };
  const updateToLatestDefaults = () => {
    if (!confirm('없는 기본 상품/세트만 추가할까요? 기존 상품·세트 설정, 현재·초기 재고와 판매 내역은 모두 유지됩니다.')) return;
    mutate('upsertDefaults', {}, () => setCart([]));
  };
  const addBundleToSettings = async () => {
    const price = Number(bundlePrice);
    const items = bundleRows.filter((r) => r.productId).map((r) => ({ productId: r.productId, qty: Number(r.qty) }));
    if (!bundleName.trim() || String(bundlePrice).trim() === '' || !Number.isInteger(price) || price < 0 || !items.length || items.some((item) => !Number.isInteger(item.qty) || item.qty <= 0)) return alert('세트 이름, 0원 이상의 정수 판매가, 구성품과 양의 정수 수량을 입력해주세요.');
    const saved = await persistBundles([...bundles, { id: uid(), name: bundleName.trim(), price, items }]);
    if (!saved) return;
    setBundleName(''); setBundlePrice(''); setBundleRows([{ productId: '', qty: 1 }]);
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
    if (!confirm('이 거래를 취소하고 재고를 복구할까요?')) return;
    setSaving(true);
    setError('');
    try {
      const nextProducts = productsAfterVoidSale(products, sale);
      const nextSales = sales.filter((item) => item.id !== sale.id);
      setProducts(nextProducts);
      setSales(nextSales);
      await persistLocalState(nextProducts, bundles, nextSales);

      const removedPendingSale = await orderRepository.deletePendingByLocalOrderId(selectedProject.id, sale.id);
      if (!removedPendingSale) {
        const createdAt = new Date().toISOString();
        await orderRepository.add({
          projectId: selectedProject.id,
          localOrderId: `void_${sale.id}_${Date.now()}`,
          createdAt,
          payload: { projectId: selectedProject.id, dataRevision, action: 'voidSale', payload: { id: sale.id } },
          syncStatus: 'PENDING',
          retryCount: 0,
          lastSyncAt: null,
        });
      }
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
  const creatorColors = useMemo(() => Object.fromEntries(creators.map((creator, index) => [creator, CREATOR_COLOR_PALETTE[index % CREATOR_COLOR_PALETTE.length]])), [creators]);
  const productsById = useMemo(() => Object.fromEntries(products.map((product) => [product.id, product])), [products]);
  const saleLineCreators = useCallback((line) => {
    if (line.creatorName) return [line.creatorName];
    if (line.type === 'product') return [creatorNameOf(productsById[line.id])];
    if (line.type === 'bundle') {
      const bundle = bundles.find((b) => b.id === line.id);
      return [...new Set((bundle?.items || []).map((item) => creatorNameOf(productsById[item.productId])))];
    }
    return ['미지정'];
  }, [bundles, productsById]);
  const saleLineProductEntries = useCallback((line) => {
    if (line.type === 'product') {
      const product = productsById[line.id];
      return [{
        productId: line.id,
        name: productNameWithoutCreator(product) || line.name,
        creator: line.creatorName || creatorNameOf(product),
        qty: Number(line.qty || 0),
        amount: Number(line.unitPrice || 0) * Number(line.qty || 0),
      }];
    }
    if (line.type === 'bundle') {
      const bundle = bundles.find((b) => b.id === line.id);
      const items = bundle?.items || [];
      const lineQty = Number(line.qty || 0);
      const lineTotal = Number(line.unitPrice || 0) * lineQty;
      const weights = items.map((item) => {
        const product = productsById[item.productId];
        const itemQty = Number(item.qty || 0);
        return Math.max(0, Number(product?.price || 0) * itemQty) || itemQty;
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      return items.map((item, index) => {
        const product = productsById[item.productId];
        return {
          productId: item.productId,
          name: productNameWithoutCreator(product) || product?.name || '알 수 없는 굿즈',
          creator: creatorNameOf(product),
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

  if (!token) return <LoginPage authMode={authMode} setAuthMode={setAuthMode} loginId={loginId} setLoginId={setLoginId} loginPassword={loginPassword} setLoginPassword={setLoginPassword} loginEmail={loginEmail} setLoginEmail={setLoginEmail} loginError={loginError} onSubmit={login} />;
  return <div className="app-shell flex h-full flex-col bg-paper text-ink">
    <AppHeader page={screen} navigate={setScreen} project={selectedProject} adminId={adminId} saving={saving} sync={sync} onRefresh={screen === 'projects' ? loadProjects : loadState} onLogout={logout} />
    {error && <div className="bg-danger px-4 py-2 text-sm text-white">{error}</div>}
    {loading || projectLoading || (selectedProject && readyScope !== scope && !error) ? <main className="page-content flex items-center justify-center" role="status">데이터를 불러오는 중...</main> : <>

    {screen === 'projects' && <ProjectsPage projects={projects} selectedProject={selectedProject} newProjectName={newProjectName} setNewProjectName={setNewProjectName} onCreateProject={createProject} onSelectProject={selectProject} />}

    {screen === 'pos' && <SalesPage purchaseTab={purchaseTab} setPurchaseTab={setPurchaseTab} visibleProducts={visibleProducts} visibleBundles={visibleBundles} creators={creators} creatorFilter={creatorFilter} setCreatorFilter={setCreatorFilter} availableStock={availableStock} bundleAvailable={bundleAvailable} addProduct={addProduct} addBundle={addBundle} cart={cart} setCart={setCart} orderExpanded={orderExpanded} setOrderExpanded={setOrderExpanded} total={total} updateCartQty={updateCartQty} saving={saving} finalizeSale={finalizeSale} />}

    {screen === 'settings' && <ProductsPage key={selectedProject.id} projectId={selectedProject.id} settingsTab={settingsTab} setSettingsTab={setSettingsTab} saving={saving} mutate={mutate} products={products} bundles={bundles} sales={sales} persistProducts={persistProducts} persistBundles={persistBundles} resetDefaults={resetDefaults} updateToLatestDefaults={updateToLatestDefaults} bundleName={bundleName} setBundleName={setBundleName} bundleRows={bundleRows} setBundleRows={setBundleRows} bundlePrice={bundlePrice} setBundlePrice={setBundlePrice} addBundleToSettings={addBundleToSettings} backupOrdersJson={backupOrdersJson} backupOrdersCsv={backupOrdersCsv} />}

    {screen === 'log' && <SettlementPage stats={stats} sales={sales} visibleSales={visibleSales} logCreatorFilter={logCreatorFilter} setLogCreatorFilter={setLogCreatorFilter} creatorSalesSummary={creatorSalesSummary} selectedCreatorSummary={selectedCreatorSummary} creatorColors={creatorColors} exportCsv={exportCsv} clearSalesWithPassword={clearSalesWithPassword} saleLineCreators={saleLineCreators} voidSale={voidSale} />}
    </>}

  </div>;
}

function LoginPage({ authMode, setAuthMode, loginId, setLoginId, loginPassword, setLoginPassword, loginEmail, setLoginEmail, loginError, onSubmit }) {
  return <div className="flex min-h-full items-center justify-center bg-paper px-4 py-10 text-ink">
    <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-xl shadow-blue-900/5">
      <div className="mb-5 text-center"><div className="display-font text-2xl font-bold text-register">마이 부스</div><p className="mt-1 text-sm text-[#526078]">관리자별 행사 프로젝트를 관리합니다.</p></div>
      <div className="mb-4 grid grid-cols-2 rounded-lg border border-line bg-white p-1 text-sm font-bold">
        <button type="button" onClick={() => setAuthMode('login')} className={`rounded-md py-2 ${authMode === 'login' ? 'bg-register text-white' : 'text-[#526078]'}`}>로그인</button>
        <button type="button" onClick={() => setAuthMode('signup')} className={`rounded-md py-2 ${authMode === 'signup' ? 'bg-register text-white' : 'text-[#526078]'}`}>회원가입</button>
      </div>
      <label className="mb-3 block text-sm font-bold">아이디<Input value={loginId} onChange={setLoginId} autoFocus className="mt-1" /></label>
      {authMode === 'signup' && <label className="mb-3 block text-sm font-bold">이메일<Input type="email" name="email" autoComplete="email" required maxLength={254} value={loginEmail} onChange={setLoginEmail} className="mt-1" /></label>}
      <label className="mb-3 block text-sm font-bold">패스워드<Input type="password" value={loginPassword} onChange={setLoginPassword} className="mt-1" /></label>
      {loginError && <div className="mb-3 rounded bg-danger px-3 py-2 text-xs text-white">{loginError}</div>}
      <button className="w-full rounded-lg bg-register px-4 py-3 font-bold text-white">{authMode === 'signup' ? '회원가입하고 시작' : '로그인'}</button>
      <p className="mt-4 text-xs leading-5 text-[#64748b]">행사별 상품과 판매 내역을 한곳에서 관리하세요.</p>
    </form>
  </div>;
}
