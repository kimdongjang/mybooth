import { allowNavigation } from './useUnsavedChanges';
import { useCallback, useEffect, useState } from 'react';

export const pagePaths = { inventoryImport:'/inventory/import', inventoryMovements:'/inventory/movements', dashboard: '/dashboard', revenue: '/revenue', inventory: '/inventory', account: '/account', pos: '/sales', settings: '/products', bundleNew: '/products/bundles/new', productNew: '/products/new', log: '/settlement', projects: '/projects', projectNew: '/projects/new', project: '/project', projectName: '/project/name', projectArchive: '/project/archive', projectDuplicate: '/project/duplicate', projectBackup: '/project/backup', projectDelete: '/project/delete', restore: '/project/restore', login: '/login', signup: '/signup' };
export const projectPages = ['project', 'projectName', 'projectArchive', 'projectDuplicate', 'projectBackup', 'projectDelete'];
export const pageTitles = { dashboard: '대시보드', revenue: '수익현황', inventory: '재고관리', account: '마이페이지', pos: '상품 판매', settings: '행사 판매 설정', bundleNew: '새 세트 등록', productNew: '새 상품 등록', log: '정산', projects: '행사 선택', projectNew: '새 행사 추가', project: '행사 관리', projectName: '행사 이름 변경', projectArchive: '행사 보관·해제', projectDuplicate: '행사 복제', projectBackup: '백업·복원', projectDelete: '행사 삭제', restore: '백업 복원' };
export const pageForHash = hash => {
  const path = String(hash).split('?')[0];
  if (/^#\/inventory\/[^/?#]+$/.test(path)) return 'inventory';
  return Object.entries(pagePaths).find(([, value]) => path === `#${value}`)?.[0] || (/^#\/products\/[^/?#]+$/.test(path) ? 'settings' : null);
};
export const productIdForHash = hash => {
  const path = String(hash).split('?')[0];
  if (Object.values(pagePaths).some(value => path === `#${value}`)) return '';
  const match = /^#\/products\/([^/?#]+)$/.exec(path);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
};
const readRoute = () => ({ page: pageForHash(window.location.hash) || 'pos', hash: window.location.hash });

export function usePageRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    let accepted = window.location.hash;
    let acceptedIndex = Number(window.history.state?.posRouteIndex || 0);
    window.history.replaceState({ ...window.history.state, posRouteIndex: acceptedIndex }, '', window.location.href);
    let pending = false;
    const update = async () => {
      const target = window.location.hash;
      if (target === accepted || pending) return;
      pending = true;
      const targetIndex = Number(window.history.state?.posRouteIndex ?? acceptedIndex + 1);
      if (await allowNavigation()) {
        accepted = target;
        acceptedIndex = targetIndex;
        window.history.replaceState({ ...window.history.state, posRouteIndex: acceptedIndex }, '', window.location.href);
        setRoute(readRoute());
      } else {
        const delta = acceptedIndex - targetIndex;
        if (delta) window.history.go(delta);
        else window.history.replaceState({ ...window.history.state, posRouteIndex: acceptedIndex }, '', accepted);
      }
      pending = false;
    };
    const follow = async event => {
      const link = event.target.closest('a[href^="#/"]');
      if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 || link.hash === window.location.hash) return;
      event.preventDefault();
      if (await allowNavigation()) {
        acceptedIndex += 1;
        accepted = link.hash;
        window.history.pushState({ posRouteIndex: acceptedIndex }, '', accepted);
        setRoute(readRoute());
      }
    };
    document.addEventListener('click', follow);
    const accept = () => { accepted = window.location.hash; acceptedIndex = Number(window.history.state?.posRouteIndex || 0); };
    window.addEventListener('pos-route-accepted', accept);
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => { window.removeEventListener('pos-route-accepted', accept); document.removeEventListener('click', follow); window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);
  const navigate = useCallback(async (next, replace = false) => {
    const path = pagePaths[next] || (typeof next === 'string' && (next.startsWith('/inventory/') || next.startsWith('/revenue?') || next.startsWith('/settlement?') || next.startsWith('/products?') || next.startsWith('/products/')) ? next : pagePaths.pos);
    const hash = `#${path}`;
    if (window.location.hash !== hash && !await allowNavigation()) return;
    const index = Number(window.history.state?.posRouteIndex || 0);
    if (replace) window.history.replaceState({ ...window.history.state, posRouteIndex: index }, '', hash);
    else if (window.location.hash !== hash) window.history.pushState({ posRouteIndex: index + 1 }, '', hash);
    window.dispatchEvent(new Event('pos-route-accepted'));
    setRoute({ page: pageForHash(hash) || 'pos', hash });
  }, []);
  return [route.page, navigate, route.hash];
}
