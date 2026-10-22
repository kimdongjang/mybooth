// Development modules must come from Vite, never from a previous app-shell cache.
export async function disableDevelopmentServiceWorker({ serviceWorker, cacheStorage, origin, reload, storage, now = Date.now() }) {
  if (!serviceWorker) return false;
  const isAppWorker = worker => {
    if (!worker?.scriptURL) return false;
    const url = new URL(worker.scriptURL);
    return url.origin === origin && url.pathname === '/sw.js';
  };
  const controlled = isAppWorker(serviceWorker.controller);
  const registrations = await serviceWorker.getRegistrations();
  for (const registration of registrations) {
    if ([registration.active, registration.waiting, registration.installing].some(isAppWorker)) await registration.unregister();
  }
  if (cacheStorage) {
    for (const key of await cacheStorage.keys()) if (key.startsWith('booth-pos-app-')) await cacheStorage.delete(key);
  }
  const marker = 'pos_dev_sw_reload';
  if (controlled) {
    // Another old tab can still register the worker. Never enter a reload loop.
    const previous = Number(storage.getItem(marker) || 0);
    if (!previous || now - previous > 30000) {
      storage.setItem(marker, String(now)); reload(); return true;
    }
  } else storage.removeItem(marker);
  return false;
}
