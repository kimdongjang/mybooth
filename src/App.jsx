import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [newProjectName, setNewProjectName] = useState('');
  const [screen, setScreen] = useState('pos');
  const [settingsTab, setSettingsTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [sales, setSales] = useState([]);
  const [cart, setCart] = useState([]);
  const [bundleRows, setBundleRows] = useState([{ productId: '', qty: 1 }]);
  const [bundleName, setBundleName] = useState('');
  const [bundlePrice, setBundlePrice] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [logCreatorFilter, setLogCreatorFilter] = useState('all');
  const getAuthToken = useCallback(() => sessionStorage.getItem(AUTH_TOKEN_KEY), []);
  const sync = useSync({ enabled: Boolean(token && selectedProject?.id), getAuthToken, projectId: selectedProject?.id });

  const persistLocalState = async (nextProducts = products, nextBundles = bundles, nextSales = sales) => {
    if (!selectedProject?.id) return;
    await stateRepository.save(selectedProject.id, { products: nextProducts, bundles: nextBundles, sales: nextSales });
  };

  const applyState = (data) => {
    const nextProducts = (data.products || []).map(normalizeProductForClient);
    const nextBundles = data.bundles || [];
    const nextSales = data.sales || [];
    setProducts(nextProducts);
    setBundles(nextBundles);
    setSales(nextSales);
    void persistLocalState(nextProducts, nextBundles, nextSales);
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
        if (cached) {
          applyState(cached);
          setError('오프라인 상태입니다. 마지막 저장 데이터를 사용합니다.');
          return;
        }
        setError('오프라인 상태입니다. 저장된 데이터가 없어 상품을 불러올 수 없습니다.');
        return;
      }

      applyState(await requestJson(`/api/pos?projectId=${encodeURIComponent(selectedProject.id)}`));
    } catch (err) {
      if (String(err.message).includes('인증')) logout();
      else {
        const cached = await stateRepository.get(selectedProject.id);
        if (cached) {
          applyState(cached);
          setError('오프라인 상태입니다. 마지막 저장 데이터를 사용합니다.');
        } else setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async () => {
    if (!token) return;
    setProjectLoading(true);
    setError('');
    try {
      const data = await requestJson('/api/pos');
      const nextProjects = data.projects || [];
      setProjects(nextProjects);
      const rememberedId = sessionStorage.getItem(SELECTED_PROJECT_KEY);
      const remembered = nextProjects.find((project) => project.id === rememberedId);
      setSelectedProject((current) => current && nextProjects.find((project) => project.id === current.id) ? current : remembered || null);
    } catch (err) {
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
    setSaving(true);
    setError('');
    try {
      const data = await requestJson('/api/pos', { method: 'POST', body: JSON.stringify({ projectId: selectedProject.id, action, payload }) });
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
  const persistCatalog = (nextProducts, nextBundles) => mutate('saveCatalog', { products: nextProducts, bundles: nextBundles });

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
      line.qty += diff;
      return line.qty <= 0 ? next.filter((_, i) => i !== index) : next;
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
      const apiPayload = { projectId: selectedProject.id, action: 'finalizeSale', payload: orderPayload };

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
    if (!confirm('현재 상품/세트 목록을 지우고 기본 44종 목록으로 되돌릴까요? (판매 내역은 유지됩니다)')) return;
    mutate('resetDefaults', {}, () => setCart([]));
  };
  const updateToLatestDefaults = () => {
    if (!confirm('최신 기본 상품/세트를 추가/업데이트할까요? 기존 판매 재고 수량은 유지되고, 없는 상품/세트만 추가됩니다.')) return;
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
          payload: { projectId: selectedProject.id, action: 'voidSale', payload: { id: sale.id } },
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

  return <div className="flex h-full flex-col bg-paper text-ink">
    <header className="flex shrink-0 items-center justify-between border-b-[3px] border-amber-pos bg-register px-4 py-2.5 text-[#eef3ee]">
      <div className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-pos" /><h1 className="display-font text-base font-semibold tracking-wide">부스 포스기</h1><span className="rounded bg-white/10 px-2 py-1 text-xs">{selectedProject.name}</span>{saving && <span className="text-xs text-amber-pos">저장 중...</span>}</div>
      <nav className="flex flex-wrap items-center justify-end gap-1.5"><SyncStatus sync={sync} />{[['pos', '판매'], ['settings', '상품/세트 관리'], ['log', '판매 내역']].map(([key, label]) => <button key={key} onClick={() => setScreen(key)} className={`rounded-md border px-3.5 py-2 text-[13px] ${screen === key ? 'border-amber-pos bg-amber-pos font-bold text-ink' : 'border-white/20 bg-white/10'}`}>{label}</button>)}<button onClick={leaveProject} className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs">프로젝트 변경</button><button onClick={loadState} className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs">새로고침</button><button onClick={logout} className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs">로그아웃</button></nav>
    </header>
    {error && <div className="bg-danger px-4 py-2 text-sm text-white">{error}</div>}

    {screen === 'pos' && <main className="flex min-h-0 flex-1">
      <section className="flex-[1.35] overflow-y-auto p-3.5">
        <SectionTitle>굿즈</SectionTitle>
        <div className="mb-3 rounded-[10px] border border-line bg-white p-3 shadow-[0_2px_0_#e7e1d1]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[#6b6555]">제작자별 보기</span>
            <span className="text-[11px] text-[#8a8370]">표시 {visibleProducts.length}/{products.length}개</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setCreatorFilter('all')} className={`rounded-full border border-line bg-[#fbfaf5] px-2 py-1 text-[11px] font-bold text-[#6b6555] ${creatorFilter === 'all' ? 'ring-2 ring-amber-pos' : ''}`}>전체 보기</button>
            {creators.map((creator) => <button key={creator} type="button" onClick={() => setCreatorFilter(creator)} className={`rounded-full border px-2 py-1 text-[11px] font-bold ${creatorFilter === creator ? 'ring-2 ring-amber-pos' : ''}`} style={{ backgroundColor: creatorColors[creator]?.bg, color: creatorColors[creator]?.text, borderColor: creatorColors[creator]?.border }}>{creator}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">{visibleProducts.map((p) => <ItemButton key={p.id} soldout={availableStock(p) <= 0} stock={`남음 ${availableStock(p)}`} name={productNameWithoutCreator(p)} price={p.price} creatorName={creatorNameOf(p)} creatorColor={creatorColors[creatorNameOf(p)]} onClick={() => addProduct(p)} />)}</div>
        {!!visibleBundles.length && <><SectionTitle>세트 할인</SectionTitle><div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">{visibleBundles.map((b) => <ItemButton key={b.id} bundle soldout={bundleAvailable(b) <= 0} stock={bundleAvailable(b) <= 0 ? '품절' : `가능 ${bundleAvailable(b)}`} name={b.name} price={b.price} onClick={() => addBundle(b)} />)}</div></>}
      </section>
      <aside className="flex w-[390px] min-w-[340px] max-w-[420px] flex-col bg-register text-[#eef3ee]">
        <div className="border-b border-dashed border-white/25 px-4.5 py-3.5"><div className="text-[11px] uppercase tracking-[2px] text-[#9db3a8]">합계</div><div className="text-[34px] font-bold">{won(total)}<span className="ml-1 text-lg text-[#9db3a8]">원</span></div></div>
        <div className="flex-1 overflow-y-auto px-3 py-1.5">{cart.length ? cart.map((line, i) => <div key={`${line.type}-${line.id}`} className="flex items-center gap-2 border-b border-white/10 px-1.5 py-2.5"><div className="flex-1 text-[13.5px]">{line.type === 'bundle' && <span className="mr-1 rounded bg-amber-pos px-1.5 py-0.5 text-[9px] text-ink">SET</span>}{line.name}<div className="text-xs text-[#9db3a8]">{won(line.unitPrice)}원</div></div><button className="h-6.5 w-6.5 rounded-md bg-white/10" onClick={() => updateCartQty(i, -1)}>−</button><span className="w-5 text-center text-sm">{line.qty}</span><button className="h-6.5 w-6.5 rounded-md bg-white/10" onClick={() => updateCartQty(i, 1)}>+</button><div className="mono w-[70px] text-right text-[13.5px] font-bold">{won(line.unitPrice * line.qty)}</div><button className="text-[#c98a8a]" onClick={() => setCart(cart.filter((_, idx) => idx !== i))}>✕</button></div>) : <div className="px-5 py-10 text-center text-sm text-[#6f8579]">굿즈를 선택해주세요</div>}</div>
        <div className="border-t border-dashed border-white/25 p-3.5"><div className="flex gap-2.5"><button disabled={!cart.length || saving} onClick={() => finalizeSale('cash')} className="flex-1 rounded-[10px] bg-cash px-2 py-4 font-bold text-white disabled:bg-[#4a5850]">현금 결제</button><button disabled={!cart.length || saving} onClick={() => finalizeSale('transfer')} className="flex-1 rounded-[10px] bg-transfer px-2 py-4 font-bold text-white disabled:bg-[#4a5850]">계좌이체 결제</button></div><button onClick={() => cart.length && confirm('장바구니를 비울까요?') && setCart([])} className="mt-2 w-full rounded-lg border border-white/25 py-2 text-xs text-[#c9c4b4]">비우기</button></div>
      </aside>
    </main>}

    {screen === 'settings' && <main className="flex-1 overflow-y-auto p-4 md:p-6"><div className="mb-4 flex flex-wrap gap-2"><button onClick={() => setSettingsTab('products')} className={`rounded-md border px-4 py-2 text-[13px] font-bold ${settingsTab === 'products' ? 'border-amber-pos bg-amber-pos text-ink' : 'border-line bg-white text-[#6b6555]'}`}>상품 관리</button><button onClick={() => setSettingsTab('bundles')} className={`rounded-md border px-4 py-2 text-[13px] font-bold ${settingsTab === 'bundles' ? 'border-amber-pos bg-amber-pos text-ink' : 'border-line bg-white text-[#6b6555]'}`}>세트 관리</button><button onClick={() => setSettingsTab('backup')} className={`rounded-md border px-4 py-2 text-[13px] font-bold ${settingsTab === 'backup' ? 'border-amber-pos bg-amber-pos text-ink' : 'border-line bg-white text-[#6b6555]'}`}>주문 백업</button></div>{settingsTab === 'products' && <ProductSettingsPanel products={products} bundles={bundles} persistProducts={persistProducts} persistCatalog={persistCatalog} onResetDefaults={resetDefaults} saving={saving} />}{settingsTab === 'bundles' && <Panel title="세트 할인 구성"><div className="space-y-2.5">{bundles.length ? bundles.map((b) => <div key={b.id} className="rounded-lg border border-line bg-[#fbfaf5] p-2.5"><div className="flex justify-between text-[13px] font-bold"><span>{b.name} — {won(b.price)}원</span><button className="rounded bg-danger px-2 py-1 text-[11px] text-white" onClick={() => confirm('세트를 삭제할까요?') && persistBundles(bundles.filter((x) => x.id !== b.id))}>삭제</button></div><div className="mt-1 text-xs text-[#6b6555]">{b.items.map((it) => `${products.find((p) => p.id === it.productId)?.name || '???'} x${it.qty}`).join(', ')}</div></div>) : <p className="text-xs text-[#8a8370]">등록된 세트가 없습니다</p>}</div><div className="mt-3 flex flex-col gap-2 border-t border-dashed border-line pt-3"><Input value={bundleName} onChange={setBundleName} placeholder="세트 이름 (예: 아크릴+포카 세트)" />{bundleRows.map((row, idx) => <div className="flex gap-1.5" key={idx}><select className="flex-1 rounded border border-line p-1.5 text-xs" value={row.productId} onChange={(e) => setBundleRows(bundleRows.map((r, i) => i === idx ? { ...r, productId: e.target.value } : r))}><option value="">굿즈 선택</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Input type="number" className="w-[60px]" value={row.qty} onChange={(v) => setBundleRows(bundleRows.map((r, i) => i === idx ? { ...r, qty: Number(v) || 1 } : r))} /></div>)}<button className="self-start rounded bg-transfer px-2.5 py-1.5 text-xs text-white" onClick={() => setBundleRows([...bundleRows, { productId: '', qty: 1 }])}>+ 구성품 추가</button><Input type="number" value={bundlePrice} onChange={setBundlePrice} placeholder="세트 판매가 (원)" /><button className="self-start rounded-md bg-register-2 px-3.5 py-2 text-[13px] text-white" onClick={addBundleToSettings}>세트 저장</button></div></Panel>}{settingsTab === 'backup' && <Panel title="주문 백업 (IndexedDB)"><p className="mb-3 text-xs text-[#6b6555]">현재 브라우저 IndexedDB에 저장된 모든 주문과 동기화 상태를 다운로드합니다.</p><div className="flex gap-2"><button className="rounded-md bg-register-2 px-3 py-2 text-xs text-white" onClick={backupOrdersJson}>주문 백업(JSON)</button><button className="rounded-md bg-transfer px-3 py-2 text-xs text-white" onClick={backupOrdersCsv}>주문 백업(CSV)</button></div></Panel>}</main>}

    {screen === 'log' && <main className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-4 grid gap-3.5 md:grid-cols-4"><Stat label="총 판매액" value={`${won(stats.total)}원`} /><Stat label="현금" value={`${won(stats.cash)}원`} /><Stat label="계좌이체" value={`${won(stats.transfer)}원`} /><Stat label="거래 건수" value={sales.length} /></div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.1fr)]">
        <section className="rounded-[10px] border border-line bg-white p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-[#6b6555]">제작자별 판매 집계</span><span className="text-[11px] text-[#8a8370]">제작자가 만든 굿즈 기준 수량/금액</span></div>
          <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" onClick={() => setLogCreatorFilter('all')} className={`rounded-full border border-line bg-[#fbfaf5] px-2 py-1 text-[11px] font-bold text-[#6b6555] ${logCreatorFilter === 'all' ? 'ring-2 ring-amber-pos' : ''}`}>전체 요약</button>{creatorSalesSummary.map(({ creator, qty, amount }) => <button key={creator} type="button" onClick={() => setLogCreatorFilter(creator)} className={`rounded-full border px-2 py-1 text-[11px] font-bold ${logCreatorFilter === creator ? 'ring-2 ring-amber-pos' : ''}`} style={{ backgroundColor: creatorColors[creator]?.bg, color: creatorColors[creator]?.text, borderColor: creatorColors[creator]?.border }}>{creator}</button>)}</div>
          <div className="mt-3 overflow-x-auto"><table className="min-w-[520px] w-full border-collapse text-[12px]"><thead><tr className="bg-[#fbfaf5] text-left text-[#6b6555]"><th className="border-b border-line p-2">제작자</th><th className="border-b border-line p-2 text-right">판매 수량</th><th className="border-b border-line p-2 text-right">판매 금액</th><th className="border-b border-line p-2">판매 굿즈</th></tr></thead><tbody>{(logCreatorFilter === 'all' ? creatorSalesSummary : selectedCreatorSummary ? [selectedCreatorSummary] : []).map((summary) => <tr key={summary.creator}><td className="border-b border-line p-2"><span className="rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: creatorColors[summary.creator]?.bg, color: creatorColors[summary.creator]?.text, borderColor: creatorColors[summary.creator]?.border }}>{summary.creator}</span></td><td className="mono border-b border-line p-2 text-right font-bold">{won(summary.qty)}개</td><td className="mono border-b border-line p-2 text-right font-bold">{won(Math.round(summary.amount))}원</td><td className="border-b border-line p-2"><div className="flex flex-col gap-1">{summary.goods.map((goods) => <div key={goods.productId} className="flex flex-wrap justify-between gap-2 rounded bg-[#fbfaf5] px-2 py-1"><span>{goods.name}</span><span className="mono text-[#6b6555]">{won(goods.qty)}개 · {won(Math.round(goods.amount))}원</span></div>)}</div></td></tr>)}</tbody></table>{!creatorSalesSummary.length && <p className="py-4 text-center text-xs text-[#8a8370]">아직 판매된 굿즈가 없습니다.</p>}</div>
        </section>
        <section>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2"><div><span className="text-xs font-bold text-[#6b6555]">실제 판매 내역</span><span className="ml-2 text-[11px] text-[#8a8370]">전체 {visibleSales.length}건</span></div><div className="flex gap-2"><button className="rounded-md bg-register-2 px-3 py-2 text-xs text-white" onClick={exportCsv}>CSV로 내보내기</button><button className="rounded-md bg-danger px-3 py-2 text-xs text-white" onClick={clearSalesWithPassword}>판매 내역 초기화</button></div></div>
          <div className="overflow-x-auto"><table className="min-w-[560px] w-full border-collapse bg-white text-[12.5px]"><thead><tr className="bg-register text-left text-[#eef3ee]"><th className="p-2">시간</th><th className="p-2">결제수단</th><th className="p-2">구성</th><th className="p-2">금액</th><th /></tr></thead><tbody>{visibleSales.map((s) => <tr key={s.id}><td className="mono border-b border-line p-2">{new Date(s.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</td><td className="border-b border-line p-2"><span className={`rounded px-2 py-0.5 text-[11px] text-white ${s.method === 'cash' ? 'bg-cash' : 'bg-transfer'}`}>{s.method === 'cash' ? '현금' : '계좌이체'}</span></td><td className="border-b border-line p-2"><div className="flex flex-col gap-1">{s.lines.map((l, index) => <div key={`${l.type}-${l.id}-${index}`} className="flex flex-wrap items-center gap-1.5"><span>{l.name} x{l.qty}</span>{saleLineCreators(l).map((creator) => <span key={creator} className="rounded-full border px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: creatorColors[creator]?.bg, color: creatorColors[creator]?.text, borderColor: creatorColors[creator]?.border }}>{creator}</span>)}</div>)}</div></td><td className="mono border-b border-line p-2">{won(s.total)}원</td><td className="border-b border-line p-2"><button className="rounded border border-danger px-2 py-1 text-[10px] text-danger" onClick={() => voidSale(s)}>취소</button></td></tr>)}</tbody></table></div>
        </section>
      </div>
    </main>}
  </div>;
}

function LoginPage({ authMode, setAuthMode, loginId, setLoginId, loginPassword, setLoginPassword, loginError, onSubmit }) {
  return <div className="flex h-full items-center justify-center bg-register px-4 text-ink">
    <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border-[3px] border-amber-pos bg-paper p-6 shadow-2xl">
      <div className="mb-5 text-center"><div className="display-font text-2xl font-bold text-register">부스 포스기</div><p className="mt-1 text-sm text-[#6b6555]">관리자별 행사 프로젝트를 관리합니다.</p></div>
      <div className="mb-4 grid grid-cols-2 rounded-lg border border-line bg-white p-1 text-sm font-bold">
        <button type="button" onClick={() => setAuthMode('login')} className={`rounded-md py-2 ${authMode === 'login' ? 'bg-register text-white' : 'text-[#6b6555]'}`}>로그인</button>
        <button type="button" onClick={() => setAuthMode('signup')} className={`rounded-md py-2 ${authMode === 'signup' ? 'bg-register text-white' : 'text-[#6b6555]'}`}>회원가입</button>
      </div>
      <label className="mb-3 block text-sm font-bold">아이디<Input value={loginId} onChange={setLoginId} autoFocus className="mt-1" /></label>
      <label className="mb-3 block text-sm font-bold">패스워드<Input type="password" value={loginPassword} onChange={setLoginPassword} className="mt-1" /></label>
      {loginError && <div className="mb-3 rounded bg-danger px-3 py-2 text-xs text-white">{loginError}</div>}
      <button className="w-full rounded-lg bg-register px-4 py-3 font-bold text-white">{authMode === 'signup' ? '회원가입하고 시작' : '로그인'}</button>
      <p className="mt-4 text-xs leading-5 text-[#8a8370]">기존 <b>ADMIN_ID/ADMIN_PASSWORD</b> 환경변수 계정은 첫 실행 시 관리자 계정으로 자동 등록됩니다.</p>
    </form>
  </div>;
}

function ProjectPage({ adminId, projects, newProjectName, setNewProjectName, onCreateProject, onSelectProject, onLogout }) {
  return <div className="min-h-full bg-paper p-4 text-ink md:p-8">
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-register p-4 text-white">
        <div><h1 className="display-font text-xl font-bold">행사 프로젝트 선택</h1><p className="mt-1 text-sm text-white/70">관리자 <b>{adminId}</b>님의 프로젝트입니다.</p></div>
        <button onClick={onLogout} className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs">로그아웃</button>
      </header>
      <form onSubmit={onCreateProject} className="mb-5 rounded-xl border border-line bg-white p-4 shadow-[0_2px_0_#e7e1d1]">
        <label className="block text-sm font-bold">새 프로젝트 만들기</label>
        <div className="mt-2 flex gap-2"><Input value={newProjectName} onChange={setNewProjectName} placeholder="예: 8월 행사, 10월 행사" /><button className="shrink-0 rounded-md bg-register px-4 py-2 text-sm font-bold text-white">생성</button></div>
      </form>
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((project) => <button key={project.id} onClick={() => onSelectProject(project)} className="rounded-xl border border-line bg-white p-4 text-left shadow-[0_2px_0_#e7e1d1] hover:border-amber-pos">
          <div className="text-lg font-bold text-register">{project.name}</div>
          <div className="mt-2 text-xs text-[#8a8370]">생성: {new Date(project.createdAt).toLocaleDateString('ko-KR')} · 최근 수정: {new Date(project.updatedAt).toLocaleString('ko-KR')}</div>
        </button>)}
      </div>
      {!projects.length && <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-[#8a8370]">아직 프로젝트가 없습니다. 예: “8월 행사” 프로젝트를 만들어 시작하세요.</div>}
    </div>
  </div>;
}

function ProductSettingsPanel({ products, bundles, persistProducts, persistBundles, onResetDefaults, onUpdateLatest }) {
  const sortedProducts = useMemo(() => [...products].sort((a, b) => String(a.productCode || a.id).localeCompare(String(b.productCode || b.id), 'ko-KR', { numeric: true })), [products]);
  const updateProduct = (id, patch) => persistProducts(products.map((product) => {
    if (product.id !== id) return product;
    const next = { ...product, ...patch };
    const stockQty = Number(next.stockQty ?? next.stock ?? 0) || 0;
    const normalized = { ...next, stockQty, stock: stockQty, name: productNameFromFields(next) };
    setDraftProducts((prev) => prev.map((item) => item.id === product.id ? normalized : item));
  };
  const saveChanges = () => persistCatalog(draftProducts, draftBundles);
  const addProduct = () => {
    const id = uid();
    setDraftProducts((prev) => [...prev, {
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
    }]);
  };
  const deleteProduct = (productId) => {
    if (!confirm('이 굿즈를 삭제할까요? 세트 구성에서도 제거됩니다.')) return;
    setDraftProducts((prev) => prev.filter((x) => x.id !== productId));
    setDraftBundles((prev) => prev.map((b) => ({ ...b, items: b.items.filter((it) => it.productId !== productId) })).filter((b) => b.items.length));
  };

  return <Panel title="굿즈 목록 (최신 상품 타입)" actions={<div className="flex flex-wrap justify-end gap-2"><button className="rounded-md bg-register-2 px-3.5 py-2 text-[13px] text-white" onClick={addProduct}>+ 굿즈 추가</button><button className="rounded-md bg-danger px-3.5 py-2 text-[13px] text-white" onClick={onResetDefaults}>기본 44종 목록으로 초기화</button><button className="rounded-md bg-cash px-4 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-[#b8b1a1]" disabled={!hasChanges || saving} onClick={saveChanges}>{saving ? '저장 중...' : '저장'}</button></div>}>
    <div className="overflow-x-auto">
      <table className="min-w-[940px] w-full border-collapse text-[12px]">
        <thead><tr className="text-left"><th className="border-b border-line p-1">코드</th><th className="border-b border-line p-1">버튜버</th><th className="border-b border-line p-1">굿즈종류</th><th className="border-b border-line p-1">제작자</th><th className="border-b border-line p-1">가격</th><th className="border-b border-line p-1">현재재고</th><th className="border-b border-line p-1">초기재고</th><th className="border-b border-line p-1">세트명</th><th className="border-b border-line p-1">세트가</th><th /></tr></thead>
        <tbody>{sortedProducts.map((p) => <tr key={p.id}>
          <td className="border-b border-line p-1"><Input value={p.productCode || p.id} className="w-[72px]" onChange={(v) => updateProduct(p, { productCode: v })} /></td>
          <td className="border-b border-line p-1"><Input value={p.vtuberName || ''} className="w-[86px]" onChange={(v) => updateProduct(p, { vtuberName: v })} /></td>
          <td className="border-b border-line p-1"><Input value={p.goodsType || ''} className="w-[112px]" onChange={(v) => updateProduct(p, { goodsType: v })} /></td>
          <td className="border-b border-line p-1"><Input value={p.creatorName || ''} className="w-[82px]" onChange={(v) => updateProduct(p, { creatorName: v })} /></td>
          <td className="border-b border-line p-1"><Input type="number" value={p.price} className="w-[78px]" onChange={(v) => updateProduct(p, { price: Number(v) || 0 })} /></td>
          <td className="border-b border-line p-1"><Input type="number" value={p.stockQty ?? p.stock ?? 0} className="w-[72px]" onChange={(v) => updateProduct(p, { stockQty: Number(v) || 0, stock: Number(v) || 0 })} /></td>
          <td className="border-b border-line p-1"><Input type="number" value={p.initialStockQty ?? 0} className="w-[72px]" onChange={(v) => updateProduct(p, { initialStockQty: Number(v) || 0 })} /></td>
          <td className="border-b border-line p-1"><Input value={p.setGroupName || ''} className="w-[130px]" onChange={(v) => updateProduct(p, { setGroupName: v || null, setCreatorName: v ? (p.creatorName || p.setCreatorName) : null })} /></td>
          <td className="border-b border-line p-1"><Input type="number" value={p.setPrice ?? ''} className="w-[78px]" onChange={(v) => updateProduct(p, { setPrice: v === '' ? null : Number(v) || 0 })} /></td>
          <td className="border-b border-line p-1"><button className="rounded bg-danger px-2 py-1 text-[11px] text-white" onClick={() => deleteProduct(p.id)}>삭제</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-[#8a8370]">입력 내용은 바로 서버에 저장되지 않습니다. 모든 수정을 마친 뒤 저장 버튼을 눌러 한 번에 반영해주세요.</p>
  </Panel>;
}

function SectionTitle({ children }) { return <div className="my-3.5 flex items-center gap-2 text-xs uppercase tracking-[1.5px] text-[#6b6555] after:h-px after:flex-1 after:bg-line">{children}</div>; }
function ItemButton({ name, price, stock, soldout, bundle, creatorName, creatorColor, onClick }) { return <button disabled={soldout} onClick={onClick} className={`relative flex min-h-[82px] flex-col justify-between rounded-[10px] border p-3 text-left shadow-[0_2px_0_#d9d4c4] active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 ${bundle ? 'border-amber-pos bg-[#fff8ea]' : 'border-line bg-white'}`}>{bundle && <span className="absolute left-2 top-2 rounded bg-amber-pos px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white">SET</span>}<span className="absolute right-2 top-2 rounded-lg bg-[#f1eee2] px-2 py-1 text-xs font-bold text-register shadow-sm">{stock}</span><span className={`text-sm font-semibold leading-tight ${bundle ? 'mt-3.5' : 'mt-5'}`}>{name}</span><div className="mt-2 flex items-end justify-between gap-2"><span className={`text-[15px] font-bold ${bundle ? 'text-amber-pos' : 'text-register-2'}`}>{won(price)}원</span>{creatorName && <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: creatorColor?.bg, color: creatorColor?.text, borderColor: creatorColor?.border }}>{creatorName}</span>}</div></button>; }
function Panel({ title, children, actions }) { return <section className="rounded-[10px] border border-line bg-white p-3.5"><div className="mb-2.5 flex items-center justify-between gap-3"><h2 className="text-[15px] font-bold">{title}</h2>{actions}</div>{children}</section>; }
function Input({ value, onChange, className = '', ...props }) { return <input {...props} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full rounded border border-line p-1.5 text-[13px] ${className}`} />; }
function Stat({ label, value }) { return <div className="rounded-[10px] border border-line bg-white p-3.5"><div className="text-[11px] uppercase tracking-wide text-[#8a8370]">{label}</div><div className="mono mt-1 text-2xl font-bold">{value}</div></div>; }