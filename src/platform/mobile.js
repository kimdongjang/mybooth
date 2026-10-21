import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { db } from '../database/dexie';
import { apiTarget, httpsOrigin, validUpdate } from './mobileConfig';

export const isNative = Capacitor.isNativePlatform();
const sessionKeys = ['pos_admin_token', 'pos_admin_id', 'pos_selected_project_id'];
const persistedKey = 'pos_native_session_v1';

// Keep the existing sessionStorage consumers working, but restore app sessions after process death.
export const sessionStore = {
  getItem: key => sessionStorage.getItem(key),
  setItem(key, value) { sessionStorage.setItem(key, value); persist(); },
  removeItem(key) { sessionStorage.removeItem(key); persist(); },
};
function persist() {
  if (isNative) localStorage.setItem(persistedKey, JSON.stringify(Object.fromEntries(
    sessionKeys.map(key => [key, sessionStorage.getItem(key)]),
  )));
}
export function saveProjectList(adminId, projects) {
  if (isNative) localStorage.setItem(`pos_native_projects:${adminId}`, JSON.stringify(projects));
}
export function readProjectList(adminId) {
  if (!isNative) return null;
  try {
    const projects = JSON.parse(localStorage.getItem(`pos_native_projects:${adminId}`));
    return Array.isArray(projects) ? projects : null;
  } catch { return null; }
}

export async function initializeMobile() {
  if (!isNative) return;
  const origin = httpsOrigin(import.meta.env.VITE_MOBILE_API_ORIGIN);
  try {
    const saved = JSON.parse(localStorage.getItem(persistedKey) || '{}');
    for (const key of sessionKeys) if (typeof saved[key] === 'string') sessionStorage.setItem(key, saved[key]);
  } catch { /* A damaged session requires an online login; never clear the order queue. */ }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch(apiTarget(String(input), origin, location.origin), options);
    }
    return originalFetch(input, options);
  };
  // Native bundles are managed atomically by the updater, not by a second SW cache.
  if ('serviceWorker' in navigator) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  }
  await db.open();
  if (!navigator.locks) throw new Error('Android System WebView를 업데이트해주세요. 안전한 주문 동기화에 Web Locks가 필요합니다.');
  await NativeApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event(navigator.onLine ? 'online' : 'offline'));
  });
}

let checking = false;
let ready = false;
export async function mobileReady() {
  if (!isNative || ready) return;
  ready = true;
  await CapacitorUpdater.notifyAppReady();
  const check = async () => {
    if (checking || !navigator.onLine) return;
    checking = true;
    try {
      const origin = httpsOrigin(import.meta.env.VITE_MOBILE_API_ORIGIN);
      const { version: nativeVersion } = await NativeApp.getInfo();
      const response = await fetch(`${origin}/mobile-updates/latest.json`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const manifest = await response.json();
      if (!validUpdate(manifest, origin, nativeVersion)) return;
      const { bundle } = await CapacitorUpdater.current();
      if (bundle.version === manifest.version) return;
      const { bundles } = await CapacitorUpdater.list();
      // Do not retry a failed/rolled-back release on every launch.
      if (bundles.some(item => item.version === manifest.version)) return;
      const downloaded = await CapacitorUpdater.download({ url: manifest.url, version: manifest.version, checksum: manifest.checksum });
      await CapacitorUpdater.setMultiDelay({ delayConditions: [{ kind: 'kill' }] });
      await CapacitorUpdater.next({ id: downloaded.id });
    } catch { /* Offline/update failure keeps the current bundle and every order intact. */ }
    finally { checking = false; }
  };
  window.addEventListener('online', check);
  void check();
}
