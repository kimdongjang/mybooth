import { useCallback, useEffect, useState } from 'react';

export const pagePaths = { pos: '/sales', settings: '/products', bundleNew: '/products/bundles/new', productNew: '/products/new', log: '/settlement', projects: '/projects', projectNew: '/projects/new', project: '/project', projectName: '/project/name', projectArchive: '/project/archive', projectDuplicate: '/project/duplicate', projectBackup: '/project/backup', projectDelete: '/project/delete', restore: '/project/restore', login: '/login', signup: '/signup' };
export const projectPages = ['project', 'projectName', 'projectArchive', 'projectDuplicate', 'projectBackup', 'projectDelete'];
export const pageTitles = { pos: '상품 판매', settings: '상품 관리', bundleNew: '새 세트 등록', productNew: '새 상품 등록', log: '정산', projects: '행사 선택', projectNew: '새 행사 추가', project: '행사 관리', projectName: '행사 이름 변경', projectArchive: '행사 보관·해제', projectDuplicate: '행사 복제', projectBackup: '백업·복원', projectDelete: '행사 삭제', restore: '백업 복원' };
const readPage = () => Object.entries(pagePaths).find(([, path]) => window.location.hash === `#${path}`)?.[0] || 'pos';

export function usePageRoute() {
  const [page, setPage] = useState(readPage);
  useEffect(() => {
    const update = () => setPage(readPage());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  const navigate = useCallback((next, replace = false) => {
    const hash = `#${pagePaths[next] || pagePaths.pos}`;
    if (replace) window.history.replaceState(null, '', hash);
    else if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setPage(next);
  }, []);
  return [page, navigate];
}
