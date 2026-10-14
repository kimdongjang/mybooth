import { upload } from '@vercel/blob/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SyncStatus } from './components/SyncStatus';
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

const uid = () => Math.random().toString(36).slice(2, 9);
const won = (n) => Number(n || 0).toLocaleString('ko-KR');
const creatorNameOf = (product) => product?.creatorName?.trim() || '미지정';
const productNameFromFields = (product) => [product.vtuberName, product.goodsType, product.creatorName ? `(${product.creatorName})` : ''].filter(Boolean).join(' ') || product.name || '새 굿즈';
const productNameWithoutCreator = (product) => String(product?.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || product?.name || '';
const normalizeProductForClient = (product) => {
  const stock = Number(product?.stock ?? product?.stockQty ?? 0) || 0;
  const stockQty = Number(product?.stockQty ?? product?.stock ?? stock) || 0;

  return {
    ...product,
    stock,
    stockQty,
    price: Number(product?.price ?? 0) || 0,
    name: product?.name || productNameFromFields(product || {}),
  };
};

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
  const [screen, setScreen] = useState('pos');
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderExpanded, setOrderExpanded] = useState(false);
  const menuToggle = useRef(null);

  useEffect(() => {
    setMenuOpen(false);
    setOrderExpanded(false);
  }, [screen, selectedProject?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuToggle.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);
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
      setSelectedProject(project);
      sessionStorage.setItem(SELECTED_PROJECT_KEY, project.id);
    } catch (err) {
      alert(err.message);
      setError(err.message);
    } finally {
      setProjectLoading(false);
    }
  };

  const selectProject = (project) => {
    setSelectedProject(project);
    sessionStorage.setItem(SELECTED_PROJECT_KEY, project.id);
    setProducts([]);
    setBundles([]);
    setSales([]);
    setCart([]);
    setScreen('pos');
  };

  const leaveProject = () => {
    setSelectedProject(null);
    sessionStorage.removeItem(SELECTED_PROJECT_KEY);
    setProducts([]);
    setBundles([]);
    setSales([]);
    setCart([]);
  };

  useEffect(() => { if (token) loadProjects(); }, [token]);
  useEffect(() => { if (token && selectedProject?.id) loadState(); }, [token, selectedProject?.id]);

  const login = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const data = await requestJson('/api/auth', { method: 'POST', body: JSON.stringify({ mode: authMode, id: loginId, password: loginPassword }) });
      sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
      sessionStorage.setItem(AUTH_ADMIN_KEY, data.admin?.id || loginId);
      setToken(data.token);
      setAdminId(data.admin?.id || loginId);
      setLoginPassword('');
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
      if (action === 'resetDefaults' || action === 'upsertDefaults') {
        const waiting = await orderRepository.countWaiting(selectedProject.id);
        if (waiting > 0) throw new Error('미동기화 주문이 남아 있습니다. 주문 동기화를 완료한 뒤 기본 상품 작업을 다시 시도해주세요.');
      }
      const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ projectId: selectedProject.id, dataRevision, action, payload }) });
      if (activeScope.current !== scope) return;
      applyState(data);
      success?.(data);
    } catch (err) {
      alert(err.message);
      setError(err.message);
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
  const addBundleToSettings = () => {
    const price = Number(bundlePrice);
    const items = bundleRows.filter((r) => r.productId).map((r) => ({ productId: r.productId, qty: Number(r.qty) || 1 }));
    if (!bundleName.trim() || !price || !items.length) return alert('세트 이름, 판매가, 구성품을 모두 입력해주세요.');
    persistBundles([...bundles, { id: uid(), name: bundleName.trim(), price, items }]);
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

  if (!token) return <LoginPage authMode={authMode} setAuthMode={setAuthMode} loginId={loginId} setLoginId={setLoginId} loginPassword={loginPassword} setLoginPassword={setLoginPassword} loginError={loginError} onSubmit={login} />;
  if (loading || projectLoading) return <div className="flex h-full items-center justify-center bg-paper text-register"><div className="rounded-xl border border-line bg-white p-6 font-bold">DB에서 데이터를 불러오는 중...</div></div>;
  if (!selectedProject) return <ProjectPage adminId={adminId} projects={projects} newProjectName={newProjectName} setNewProjectName={setNewProjectName} onCreateProject={createProject} onSelectProject={selectProject} onLogout={logout} />;

  return <div className="app-shell flex h-full flex-col bg-paper text-ink">
    <header className="app-header border-b border-line bg-white text-ink">
      <div className="header-brand flex min-w-0 items-center gap-2.5"><span className="h-2 w-2 shrink-0 rounded-full bg-register" /><div className="min-w-0"><h1 className="display-font text-base font-bold">마이 부스</h1><p className="truncate text-xs text-slate-500" title={selectedProject.name}>{selectedProject.name}</p></div>{saving && <span className="shrink-0 text-xs text-register">저장 중...</span>}</div>
      <div className="header-controls"><SyncStatus sync={sync} /><button ref={menuToggle} type="button" className={`menu-toggle ${menuOpen ? 'is-open' : ''}`} aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={menuOpen} aria-controls="booth-navigation" onClick={() => setMenuOpen(!menuOpen)}><span className="hamburger-lines" aria-hidden="true"><span /><span /><span /></span></button></div>
      <nav id="booth-navigation" aria-label="부스 메뉴" className={`booth-navigation ${menuOpen ? 'is-open' : ''}`}>
        <div className="nav-screens">{[['pos', '판매'], ['settings', '상품/세트 관리'], ['log', '판매 내역']].map(([key, label]) => <button key={key} aria-current={screen === key ? 'page' : undefined} onClick={() => { setScreen(key); setMenuOpen(false); }} className={screen === key ? 'is-active' : ''}>{label}</button>)}</div>
        <div className="nav-utilities"><button onClick={() => { setMenuOpen(false); leaveProject(); }}>프로젝트 변경</button><button onClick={() => { setMenuOpen(false); loadState(); }}>새로고침</button><button onClick={() => { setMenuOpen(false); logout(); }}>로그아웃</button></div>
      </nav>
    </header>
    {error && <div className="bg-danger px-4 py-2 text-sm text-white">{error}</div>}

    {screen === 'pos' && <main className="pos-layout flex min-h-0 flex-1 gap-5 p-5">
      <section className="catalog min-w-0 flex-1 overflow-y-auto">
        <div className="catalog-heading mb-4 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold tracking-tight">상품 판매</h2><p className="mt-1 text-xs text-slate-500">상품을 눌러 주문에 추가하세요.</p></div><span className="shrink-0 text-xs text-slate-500">{purchaseTab === 'products' ? `${visibleProducts.length}개 상품` : `${visibleBundles.length}개 세트`}</span></div>
        <div className="purchase-tabs" role="tablist" aria-label="구매 방식">
          {[['products', '단품 구매'], ['bundles', '세트 구매']].map(([key, label], index) => <button key={key} id={`purchase-tab-${key}`} type="button" role="tab" aria-selected={purchaseTab === key} aria-controls="purchase-panel" tabIndex={purchaseTab === key ? 0 : -1} onClick={() => setPurchaseTab(key)} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'products' : event.key === 'End' ? 'bundles' : index === 0 ? 'bundles' : 'products';
            setPurchaseTab(next);
            document.getElementById(`purchase-tab-${next}`)?.focus();
          }}>{label}</button>)}
        </div>
        <div className="catalog-filters" role="group" aria-label="제작자 필터">
          <span className="filter-label">제작자</span>
          <div className="filter-options">
            <button type="button" aria-pressed={creatorFilter === 'all'} onClick={() => setCreatorFilter('all')}>전체</button>
            {creators.map((creator) => <button key={creator} type="button" aria-pressed={creatorFilter === creator} onClick={() => setCreatorFilter(creator)}>{creator}</button>)}
          </div>
        </div>
        <div id="purchase-panel" role="tabpanel" aria-labelledby={`purchase-tab-${purchaseTab}`} tabIndex={0}>
          {purchaseTab === 'products' ? <div className="product-grid grid gap-3">{visibleProducts.map((p) => <ItemButton key={p.id} imageUrl={p.imageUrl} soldout={availableStock(p) <= 0} stock={`남음 ${availableStock(p)}`} name={productNameWithoutCreator(p)} price={p.price} creatorName={creatorNameOf(p)} onClick={() => addProduct(p)} />)}</div> : <div className="product-grid grid gap-3">{visibleBundles.map((b) => <ItemButton key={b.id} bundle soldout={bundleAvailable(b) <= 0} stock={bundleAvailable(b) <= 0 ? '품절' : `가능 ${bundleAvailable(b)}`} name={b.name} price={b.price} onClick={() => addBundle(b)} />)}</div>}
          {!(purchaseTab === 'products' ? visibleProducts.length : visibleBundles.length) && <p className="catalog-empty">{creatorFilter !== 'all' ? `선택한 제작자의 ${purchaseTab === 'products' ? '상품' : '세트'}가 없습니다.` : purchaseTab === 'products' ? '등록된 상품이 없습니다.' : '등록된 세트가 없습니다.'}</p>}
        </div>
      </section>
      <aside className="order-panel flex shrink-0 flex-col rounded-2xl border border-line bg-white text-ink">
        <div className="order-summary"><div><div className="flex items-center gap-2"><h2 className="text-sm font-bold">현재 주문</h2><span className="text-xs text-slate-500">{cart.reduce((count, line) => count + line.qty, 0)}개</span></div><button type="button" className="order-detail-toggle" aria-expanded={orderExpanded} aria-controls="order-lines" onClick={() => setOrderExpanded(!orderExpanded)}>{orderExpanded ? '주문 접기 ∨' : '주문 상세 ∧'}</button></div><div className="text-right"><div className="text-xs text-slate-500">결제할 금액</div><div className="order-total mono font-bold text-register" aria-live="polite">{won(total)}<span className="ml-1 text-sm text-slate-500">원</span></div></div></div>
        <div id="order-lines" className={`order-lines flex-1 overflow-y-auto px-3 py-1.5 ${orderExpanded ? 'is-expanded' : ''}`}>{cart.length ? cart.map((line, i) => <div key={`${line.type}-${line.id}`} className="flex items-center gap-2 border-b border-line px-1.5 py-2.5"><div className="flex-1 text-[13.5px]">{line.type === 'bundle' && <span className="mr-1 rounded bg-amber-pos px-1.5 py-0.5 text-[9px] text-white">SET</span>}{line.name}<div className="text-xs text-[#64748b]">{won(line.unitPrice)}원</div></div><button className="h-9 w-9 shrink-0 rounded-lg border border-line bg-paper" aria-label={`${line.name} 수량 줄이기`} onClick={() => updateCartQty(i, -1)}>−</button><span className="w-5 text-center text-sm">{line.qty}</span><button className="h-9 w-9 shrink-0 rounded-lg border border-line bg-paper" aria-label={`${line.name} 수량 늘리기`} onClick={() => updateCartQty(i, 1)}>+</button><div className="mono w-[70px] text-right text-[13.5px] font-bold">{won(line.unitPrice * line.qty)}</div><button aria-label={`${line.name} 주문에서 제거`} className="h-9 w-9 shrink-0 text-[#dc2626]" onClick={() => setCart(cart.filter((_, idx) => idx !== i))}>✕</button></div>) : <div className="px-5 py-10 text-center text-sm text-[#64748b]">굿즈를 선택해주세요</div>}</div>
        <div className="order-actions border-t border-line p-3.5"><p className="mb-3 text-xs leading-5 text-slate-500">수령 확인 후 결제를 기록하세요.</p><div className="flex gap-2.5"><button disabled={!cart.length || saving} onClick={() => finalizeSale('cash')} className="flex-1 rounded-2xl bg-cash px-2 py-4 font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">현금 결제</button><button disabled={!cart.length || saving} onClick={() => finalizeSale('transfer')} className="flex-1 rounded-2xl bg-transfer px-2 py-4 font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">계좌이체</button></div><button onClick={() => cart.length && confirm('장바구니를 비울까요?') && setCart([])} className="mt-2 w-full rounded-lg border border-line py-2 text-xs text-[#526078]">비우기</button></div>
      </aside>
    </main>}

    {screen === 'settings' && <main className="settings-page flex-1 overflow-y-auto p-4 md:p-6"><SettingsTabs selected={settingsTab} onSelect={setSettingsTab} /><div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${settingsTab}`} tabIndex={0} className="settings-content">{settingsTab === 'products' && <ProductSettingsPanel key={selectedProject.id} projectId={selectedProject.id} saving={saving} onImageChange={(productId, imageUrl) => mutate('updateProductImage', { productId, imageUrl })} products={products} bundles={bundles} persistProducts={persistProducts} persistBundles={persistBundles} onResetDefaults={resetDefaults} onUpdateLatest={updateToLatestDefaults} />}{settingsTab === 'bundles' && <Panel title="세트 할인 구성"><div className="space-y-2.5">{bundles.length ? bundles.map((b) => <div key={b.id} className="rounded-lg border border-line bg-[#f8fafc] p-2.5"><div className="flex justify-between text-[13px] font-bold"><span>{b.name} — {won(b.price)}원</span><button className="rounded bg-danger px-2 py-1 text-[11px] text-white" onClick={() => confirm('세트를 삭제할까요?') && persistBundles(bundles.filter((x) => x.id !== b.id))}>삭제</button></div><div className="mt-1 text-xs text-[#526078]">{b.items.map((it) => `${products.find((p) => p.id === it.productId)?.name || '???'} x${it.qty}`).join(', ')}</div></div>) : <p className="text-xs text-[#64748b]">등록된 세트가 없습니다</p>}</div><div className="mt-3 flex flex-col gap-2 border-t border-dashed border-line pt-3"><Input value={bundleName} onChange={setBundleName} placeholder="세트 이름 (예: 아크릴+포카 세트)" />{bundleRows.map((row, idx) => <div className="flex gap-1.5" key={idx}><select className="flex-1 rounded border border-line p-1.5 text-xs" value={row.productId} onChange={(e) => setBundleRows(bundleRows.map((r, i) => i === idx ? { ...r, productId: e.target.value } : r))}><option value="">굿즈 선택</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Input type="number" className="w-[60px]" value={row.qty} onChange={(v) => setBundleRows(bundleRows.map((r, i) => i === idx ? { ...r, qty: Number(v) || 1 } : r))} /></div>)}<button className="self-start rounded bg-transfer px-2.5 py-1.5 text-xs text-white" onClick={() => setBundleRows([...bundleRows, { productId: '', qty: 1 }])}>+ 구성품 추가</button><Input type="number" value={bundlePrice} onChange={setBundlePrice} placeholder="세트 판매가 (원)" /><button className="self-start rounded-md bg-register-2 px-3.5 py-2 text-[13px] text-white" onClick={addBundleToSettings}>세트 저장</button></div></Panel>}{settingsTab === 'backup' && <Panel title="주문 백업 (IndexedDB)"><p className="mb-3 text-xs text-[#526078]">현재 브라우저 IndexedDB에 저장된 모든 주문과 동기화 상태를 다운로드합니다.</p><div className="flex gap-2"><button className="rounded-md bg-register-2 px-3 py-2 text-xs text-white" onClick={backupOrdersJson}>주문 백업(JSON)</button><button className="rounded-md bg-transfer px-3 py-2 text-xs text-white" onClick={backupOrdersCsv}>주문 백업(CSV)</button></div></Panel>}</div></main>}

    {screen === 'log' && <main className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-4 grid gap-3.5 md:grid-cols-4"><Stat label="총 판매액" value={`${won(stats.total)}원`} /><Stat label="현금" value={`${won(stats.cash)}원`} /><Stat label="계좌이체" value={`${won(stats.transfer)}원`} /><Stat label="거래 건수" value={sales.length} /></div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.1fr)]">
        <section className="rounded-2xl border border-line bg-white p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-[#526078]">제작자별 판매 집계</span><span className="text-[11px] text-[#64748b]">제작자가 만든 굿즈 기준 수량/금액</span></div>
          <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" onClick={() => setLogCreatorFilter('all')} className={`rounded-full border border-line bg-[#f8fafc] px-2 py-1 text-[11px] font-bold text-[#526078] ${logCreatorFilter === 'all' ? 'ring-2 ring-amber-pos' : ''}`}>전체 요약</button>{creatorSalesSummary.map(({ creator, qty, amount }) => <button key={creator} type="button" onClick={() => setLogCreatorFilter(creator)} className={`rounded-full border px-2 py-1 text-[11px] font-bold ${logCreatorFilter === creator ? 'ring-2 ring-amber-pos' : ''}`} style={{ backgroundColor: creatorColors[creator]?.bg, color: creatorColors[creator]?.text, borderColor: creatorColors[creator]?.border }}>{creator}</button>)}</div>
          <div className="mt-3 overflow-x-auto"><table className="min-w-[520px] w-full border-collapse text-[12px]"><thead><tr className="bg-[#f8fafc] text-left text-[#526078]"><th className="border-b border-line p-2">제작자</th><th className="border-b border-line p-2 text-right">판매 수량</th><th className="border-b border-line p-2 text-right">판매 금액</th><th className="border-b border-line p-2">판매 굿즈</th></tr></thead><tbody>{(logCreatorFilter === 'all' ? creatorSalesSummary : selectedCreatorSummary ? [selectedCreatorSummary] : []).map((summary) => <tr key={summary.creator}><td className="border-b border-line p-2"><span className="rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: creatorColors[summary.creator]?.bg, color: creatorColors[summary.creator]?.text, borderColor: creatorColors[summary.creator]?.border }}>{summary.creator}</span></td><td className="mono border-b border-line p-2 text-right font-bold">{won(summary.qty)}개</td><td className="mono border-b border-line p-2 text-right font-bold">{won(Math.round(summary.amount))}원</td><td className="border-b border-line p-2"><div className="flex flex-col gap-1">{summary.goods.map((goods) => <div key={goods.productId} className="flex flex-wrap justify-between gap-2 rounded bg-[#f8fafc] px-2 py-1"><span>{goods.name}</span><span className="mono text-[#526078]">{won(goods.qty)}개 · {won(Math.round(goods.amount))}원</span></div>)}</div></td></tr>)}</tbody></table>{!creatorSalesSummary.length && <p className="py-4 text-center text-xs text-[#64748b]">아직 판매된 굿즈가 없습니다.</p>}</div>
        </section>
        <section>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2"><div><span className="text-xs font-bold text-[#526078]">실제 판매 내역</span><span className="ml-2 text-[11px] text-[#64748b]">전체 {visibleSales.length}건</span></div><div className="flex gap-2"><button className="rounded-md bg-register-2 px-3 py-2 text-xs text-white" onClick={exportCsv}>CSV로 내보내기</button><button className="rounded-md bg-danger px-3 py-2 text-xs text-white" onClick={clearSalesWithPassword}>판매 내역 초기화</button></div></div>
          <div className="overflow-x-auto"><table className="min-w-[560px] w-full border-collapse bg-white text-[12.5px]"><thead><tr className="bg-register text-left text-[#eef3ee]"><th className="p-2">시간</th><th className="p-2">결제수단</th><th className="p-2">구성</th><th className="p-2">금액</th><th /></tr></thead><tbody>{visibleSales.map((s) => <tr key={s.id}><td className="mono border-b border-line p-2">{new Date(s.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</td><td className="border-b border-line p-2"><span className={`rounded px-2 py-0.5 text-[11px] text-white ${s.method === 'cash' ? 'bg-cash' : 'bg-transfer'}`}>{s.method === 'cash' ? '현금' : '계좌이체'}</span></td><td className="border-b border-line p-2"><div className="flex flex-col gap-1">{s.lines.map((l, index) => <div key={`${l.type}-${l.id}-${index}`} className="flex flex-wrap items-center gap-1.5"><span>{l.name} x{l.qty}</span>{saleLineCreators(l).map((creator) => <span key={creator} className="rounded-full border px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: creatorColors[creator]?.bg, color: creatorColors[creator]?.text, borderColor: creatorColors[creator]?.border }}>{creator}</span>)}</div>)}</div></td><td className="mono border-b border-line p-2">{won(s.total)}원</td><td className="border-b border-line p-2"><button className="rounded border border-danger px-2 py-1 text-[10px] text-danger" onClick={() => voidSale(s)}>취소</button></td></tr>)}</tbody></table></div>
        </section>
      </div>
    </main>}
  </div>;
}

function LoginPage({ authMode, setAuthMode, loginId, setLoginId, loginPassword, setLoginPassword, loginError, onSubmit }) {
  return <div className="flex min-h-full items-center justify-center bg-paper px-4 py-10 text-ink">
    <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-xl shadow-blue-900/5">
      <div className="mb-5 text-center"><div className="display-font text-2xl font-bold text-register">마이 부스</div><p className="mt-1 text-sm text-[#526078]">관리자별 행사 프로젝트를 관리합니다.</p></div>
      <div className="mb-4 grid grid-cols-2 rounded-lg border border-line bg-white p-1 text-sm font-bold">
        <button type="button" onClick={() => setAuthMode('login')} className={`rounded-md py-2 ${authMode === 'login' ? 'bg-register text-white' : 'text-[#526078]'}`}>로그인</button>
        <button type="button" onClick={() => setAuthMode('signup')} className={`rounded-md py-2 ${authMode === 'signup' ? 'bg-register text-white' : 'text-[#526078]'}`}>회원가입</button>
      </div>
      <label className="mb-3 block text-sm font-bold">아이디<Input value={loginId} onChange={setLoginId} autoFocus className="mt-1" /></label>
      <label className="mb-3 block text-sm font-bold">패스워드<Input type="password" value={loginPassword} onChange={setLoginPassword} className="mt-1" /></label>
      {loginError && <div className="mb-3 rounded bg-danger px-3 py-2 text-xs text-white">{loginError}</div>}
      <button className="w-full rounded-lg bg-register px-4 py-3 font-bold text-white">{authMode === 'signup' ? '회원가입하고 시작' : '로그인'}</button>
      <p className="mt-4 text-xs leading-5 text-[#64748b]">행사별 상품과 판매 내역을 한곳에서 관리하세요.</p>
    </form>
  </div>;
}

function ProjectPage({ adminId, projects, newProjectName, setNewProjectName, onCreateProject, onSelectProject, onLogout }) {
  return <div className="min-h-full bg-white p-4 text-ink md:p-8">
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-register p-4 text-white">
        <div><h1 className="display-font text-xl font-bold">행사 프로젝트 선택</h1><p className="mt-1 text-sm text-white/70"><b>{adminId}</b>님의 행사별 상품·가격·재고를 관리합니다.</p></div>
        <button onClick={onLogout} className="rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-paper">로그아웃</button>
      </header>
      <form onSubmit={onCreateProject} className="mb-5 rounded-xl border border-line bg-white p-4 shadow-[0_2px_0_#e2e8f0]">
        <label className="block text-sm font-bold">새 프로젝트 만들기</label>
        <div className="mt-2 flex gap-2"><Input value={newProjectName} onChange={setNewProjectName} placeholder="예: 8월 행사, 10월 행사" /><button className="shrink-0 rounded-md bg-register px-4 py-2 text-sm font-bold text-white">생성</button></div>
      </form>
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((project) => <button key={project.id} onClick={() => onSelectProject(project)} className="rounded-xl border border-line bg-white p-4 text-left shadow-[0_2px_0_#e2e8f0] hover:border-amber-pos">
          <div className="text-lg font-bold text-register">{project.name}</div>
          <div className="mt-2 text-xs text-[#64748b]">생성: {new Date(project.createdAt).toLocaleDateString('ko-KR')} · 최근 수정: {new Date(project.updatedAt).toLocaleString('ko-KR')}</div>
        </button>)}
      </div>
      {!projects.length && <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-[#64748b]">아직 프로젝트가 없습니다. 예: “8월 행사” 프로젝트를 만들어 시작하세요.</div>}
    </div>
  </div>;
}

function SettingsTabs({ selected, onSelect }) {
  const tabs = [['products', '상품관리'], ['bundles', '세트관리'], ['backup', '주문백업']];
  const changeWithKeyboard = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    onSelect(tabs[next][0]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return <div className="settings-navigation purchase-tabs" role="tablist" aria-label="상품 및 주문 관리">
    {tabs.map(([key, label], index) => <button key={key} id={`settings-tab-${key}`} type="button" role="tab" aria-selected={selected === key} aria-controls="settings-panel" tabIndex={selected === key ? 0 : -1} onClick={() => onSelect(key)} onKeyDown={(event) => changeWithKeyboard(event, index)}>{label}</button>)}
  </div>;
}

function ProductSettingsPanel({ projectId, saving, onImageChange, products, bundles, persistProducts, persistBundles, onResetDefaults, onUpdateLatest }) {
  const [uploadingId, setUploadingId] = useState(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const backButton = useRef(null);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(products.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const selectedProduct = products.find((product) => product.id === selectedId);
  useEffect(() => { setPage((previous) => Math.min(previous, pageCount)); }, [pageCount]);
  useEffect(() => { if (selectedProduct) backButton.current?.focus(); }, [selectedProduct?.id]);
  const uploadImage = async (product, file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return alert('JPG, PNG, WebP 이미지를 5MB 이하로 선택해주세요.');
    if (!navigator.onLine) return alert('이미지 등록은 인터넷 연결이 필요합니다.');
    setUploadingId(product.id);
    try {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      const blob = await upload(`products/${encodeURIComponent(projectId)}/${encodeURIComponent(product.id)}/${crypto.randomUUID()}.${extension}`, file, {
        access: 'public', handleUploadUrl: '/api/product-images', contentType: file.type,
        clientPayload: JSON.stringify({ projectId, productId: product.id }),
        headers: { Authorization: `Bearer ${sessionStorage.getItem(AUTH_TOKEN_KEY)}` },
      });
      await onImageChange(product.id, blob.url);
    } catch (error) { alert(error.message || '이미지 등록에 실패했습니다.'); }
    finally { setUploadingId(null); }
  };
  const sortedProducts = useMemo(() => [...products].sort((a, b) => String(a.productCode || a.id).localeCompare(String(b.productCode || b.id), 'ko-KR', { numeric: true })), [products]);
  const updateProduct = (id, patch) => persistProducts(products.map((product) => {
    if (product.id !== id) return product;
    const next = { ...product, ...patch };
    const stockQty = Number(next.stockQty ?? next.stock ?? 0) || 0;
    return { ...next, stockQty, stock: stockQty, name: productNameFromFields(next) };
  }));
  const addProduct = () => {
    const id = uid();
    persistProducts([...products, {
      id,
      productCode: id,
      goodsType: '새 굿즈',
      vtuberName: '',
      creatorName: '',
      stockQty: 0,
      initialStockQty: 0,
      size: '',
      price: 0,
      setCreatorName: null,
      setGroupName: null,
      setPrice: null,
      setDescription: null,
      isActive: true,
      name: '새 굿즈',
      stock: 0,
      createdAt: new Date().toISOString(),
    }]);
    setSelectedId(id);
  };
  const deleteProduct = (productId) => {
    if (!confirm('이 굿즈를 삭제할까요? 세트 구성에서도 제거됩니다.')) return;
    persistProducts(products.filter((x) => x.id !== productId));
    persistBundles(bundles.map((b) => ({ ...b, items: b.items.filter((it) => it.productId !== productId) })).filter((b) => b.items.length));
  };

  const field = (product, title, value, patch, type = 'text') => <label className="management-field"><span>{title}</span><Input type={type} value={value} onChange={(v) => updateProduct(product.id, patch(v))} /></label>;

  return <section className="product-management">
    <header className="management-heading">
      <div><h2>{selectedProduct ? '상품 상세' : '상품 관리'}</h2><p>{selectedProduct ? '이미지와 상품 정보를 수정하세요. 수정한 내용은 자동으로 저장됩니다.' : '상품을 한눈에 확인하고 상세보기에서 정보를 수정하세요.'}</p></div>
      {selectedProduct ? <button ref={backButton} type="button" className="management-back" onClick={() => setSelectedId(null)}>← 목록으로</button> : <button type="button" className="management-add" onClick={addProduct}>+ 상품 추가</button>}
    </header>
    <div className="management-summary"><span>등록 상품 <b>{products.length}개</b></span><span role="status">{saving ? '변경 사항 저장 중…' : '상품 정보를 수정할 수 있습니다'}</span></div>
    {!selectedProduct && <>
      <div className="management-table-wrap"><table className="management-table">
        <caption className="sr-only">상품 이름, 제작자, 가격, 등록일 목록</caption>
        <colgroup><col className="management-name-column" /><col /><col /><col /></colgroup>
        <thead><tr><th scope="col">상품 이름</th><th scope="col">제작자</th><th scope="col">가격</th><th scope="col">등록일</th></tr></thead>
        <tbody>{sortedProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((p) => <tr key={p.id}>
          <td><span className="management-row-name">{productNameWithoutCreator(p)}</span><button type="button" className="management-detail-link" aria-label={`${productNameWithoutCreator(p)} 상세보기`} onClick={() => setSelectedId(p.id)}>상세보기</button></td>
          <td>{creatorNameOf(p)}</td><td className="mono management-row-price">{won(p.price)}원</td>
          <td>{p.createdAt && !Number.isNaN(new Date(p.createdAt).getTime()) ? <time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '')}</time> : '—'}</td>
        </tr>)}</tbody>
      </table>{!products.length && <div className="management-empty"><h3>등록된 상품이 없습니다</h3><p>상품 추가 버튼으로 첫 상품을 등록하세요.</p></div>}</div>
      <nav className="management-pagination" aria-label="상품 목록 페이지"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span aria-live="polite">{currentPage} / {pageCount} 페이지</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</button></nav>
    </>}
    {selectedProduct && <div className="management-products">
      {[selectedProduct].map((p) => <article className="management-product" key={p.id}>
        <div className="management-product-header"><h3>{productNameWithoutCreator(p)}</h3><button type="button" className="management-delete" aria-label={`${p.name} 상품 삭제`} onClick={() => deleteProduct(p.id)}>삭제</button></div>
        <div className="management-product-body">
          <div className="management-image">
            <ProductImage imageUrl={p.imageUrl} name={p.name} />
            <label className="management-upload"><span>{uploadingId === p.id ? '업로드 중…' : p.imageUrl ? '이미지 수정' : '이미지 등록'}</span><input aria-label={`${p.name} 이미지 등록 또는 수정`} type="file" accept="image/jpeg,image/png,image/webp" disabled={saving || uploadingId !== null} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; uploadImage(p, file); }} /></label>
            {p.imageUrl && <button type="button" disabled={saving || uploadingId !== null} className="management-delete" onClick={() => onImageChange(p.id, null)}>이미지 제거</button>}
            <p>JPG · PNG · WebP / 최대 5MB</p>
          </div>
          <div className="management-details">
            <fieldset><legend>기본 정보</legend><div className="management-fields">
              {field(p, '상품 코드', p.productCode || p.id, (v) => ({ productCode: v }))}
              {field(p, '버튜버', p.vtuberName || '', (v) => ({ vtuberName: v }))}
              {field(p, '굿즈 종류', p.goodsType || '', (v) => ({ goodsType: v }))}
              {field(p, '제작자', p.creatorName || '', (v) => ({ creatorName: v }))}
            </div></fieldset>
            <fieldset><legend>가격 · 재고</legend><div className="management-fields management-fields-three">
              {field(p, '판매가 (원)', p.price, (v) => ({ price: Number(v) || 0 }), 'number')}
              {field(p, '현재 재고', p.stockQty ?? p.stock ?? 0, (v) => ({ stockQty: Number(v) || 0, stock: Number(v) || 0 }), 'number')}
              {field(p, '초기 재고', p.initialStockQty ?? 0, (v) => ({ initialStockQty: Number(v) || 0 }), 'number')}
            </div></fieldset>
            <fieldset><legend>세트 정보 <span>선택 입력</span></legend><div className="management-fields">
              {field(p, '세트명', p.setGroupName || '', (v) => ({ setGroupName: v || null, setCreatorName: v ? (p.creatorName || p.setCreatorName) : null }))}
              {field(p, '세트가 (원)', p.setPrice ?? '', (v) => ({ setPrice: v === '' ? null : Number(v) || 0 }), 'number')}
            </div></fieldset>
          </div>
        </div>
      </article>)}
    </div>}
    {!selectedProduct && <aside className="management-defaults"><div><h3>기본 상품 목록</h3><p>누락된 기본 상품·세트만 추가하거나, 상품·세트·재고를 기본 44종으로 초기화할 수 있습니다.</p></div><div className="management-default-actions"><button type="button" onClick={onUpdateLatest}>없는 기본 상품/세트 추가</button><button type="button" className="management-delete" onClick={onResetDefaults}>기본 44종 목록으로 초기화</button></div></aside>}
  </section>;
}

function ProductImage({ imageUrl, name }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [defaultFailed, setDefaultFailed] = useState(false);
  const isDefault = !imageUrl || imageUrl === failedUrl;
  const source = isDefault ? '/images/default-product.svg' : imageUrl;
  return <div className="product-image flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
    {isDefault && defaultFailed ? <span className="text-xs text-[#64748b]">No Image</span> : <img key={source} src={source} alt={isDefault ? 'No Image' : name || '상품 이미지'} loading="lazy" className="h-full w-full object-contain" onError={() => isDefault ? setDefaultFailed(true) : setFailedUrl(imageUrl)} />}
  </div>;
}

function ItemButton({ name, imageUrl, price, stock, soldout, bundle, creatorName, onClick }) {
  return <button disabled={soldout} onClick={onClick} className={`product-card flex min-w-0 flex-col overflow-hidden rounded-xl border text-left transition hover:border-register hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed ${bundle ? 'border-blue-200 bg-blue-50' : 'border-line bg-white'} ${soldout ? 'is-soldout' : ''}`}>
    {!bundle && <ProductImage imageUrl={imageUrl} name={name} />}
    <div className="flex flex-1 flex-col p-3">
      {bundle && <span className="mb-2 text-[10px] font-bold tracking-wide text-register">세트 할인</span>}
      <span className="product-name break-words">{name}</span>
      {creatorName && <span className="product-creator mt-1 self-start max-w-full break-words">{creatorName}</span>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-3"><span className="product-price mono text-register">{won(price)}원</span><span className={`product-stock ${soldout ? 'text-danger' : 'text-slate-500'}`}>{soldout ? '품절' : stock}</span></div>
    </div>
  </button>;
}
function Panel({ title, children, actions }) { return <section className="rounded-2xl border border-line bg-white p-3.5"><div className="mb-2.5 flex items-center justify-between gap-3"><h2 className="text-[15px] font-bold">{title}</h2>{actions}</div>{children}</section>; }
function Input({ value, onChange, className = '', ...props }) { return <input {...props} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full rounded border border-line p-1.5 text-[13px] ${className}`} />; }
function Stat({ label, value }) { return <div className="rounded-2xl border border-line bg-white p-3.5"><div className="text-[11px] uppercase tracking-wide text-[#64748b]">{label}</div><div className="mono mt-1 text-2xl font-bold">{value}</div></div>; }
