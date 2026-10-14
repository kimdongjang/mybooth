import { useCallback, useEffect, useState } from 'react';

export const pagePaths = { pos: '/sales', settings: '/products', log: '/settlement', projects: '/projects' };
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
