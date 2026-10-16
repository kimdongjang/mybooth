import { useCallback, useEffect, useState } from 'react';

export const pagePaths = { inventory: '/inventory', account: '/account', pos: '/sales', settings: '/products', bundleNew: '/products/bundles/new', productNew: '/products/new', log: '/settlement', projects: '/projects', projectNew: '/projects/new', project: '/project', projectName: '/project/name', projectArchive: '/project/archive', projectDuplicate: '/project/duplicate', projectBackup: '/project/backup', projectDelete: '/project/delete', restore: '/project/restore', login: '/login', signup: '/signup' };
export const projectPages = ['project', 'projectName', 'projectArchive', 'projectDuplicate', 'projectBackup', 'projectDelete'];
export const pageTitles = { inventory: '재고 관리', account: '내 계정', pos: '상품 판매', settings: '상품 관리', bundleNew: '새 세트 등록', productNew: '새 상품 등록', log: '정산', projects: '행사 선택', projectNew: '새 행사 추가', project: '행사 관리', projectName: '행사 이름 변경', projectArchive: '행사 보관·해제', projectDuplicate: '행사 복제', projectBackup: '백업·복원', projectDelete: '행사 삭제', restore: '백업 복원' };
export const pageForHash = hash => {
  const path = String(hash).split('?')[0];
  if (/^#\/inventory\/[^/?#]+$/.test(path)) return 'inventory';
  return Object.entries(pagePaths).find(([, value]) => path === `#${value}`)?.[0] || null;
};
const readRoute = () => ({ page: pageForHash(window.location.hash) || 'pos', hash: window.location.hash });

export function usePageRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);
  const navigate = useCallback((next, replace = false) => {
    const path = pagePaths[next] || (typeof next === 'string' && (next.startsWith('/inventory/') || next.startsWith('/settlement?')) ? next : pagePaths.pos);
    const hash = `#${path}`;
    if (replace) window.history.replaceState(null, '', hash);
    else if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setRoute({ page: pageForHash(hash) || 'pos', hash });
  }, []);
  return [route.page, navigate, route.hash];
}
