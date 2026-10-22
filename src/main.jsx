import { disableDevelopmentServiceWorker } from './platform/developmentServiceWorker';
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { initializeMobile, isNative, mobileReady } from './platform/mobile';

function MobileReady() {
  useEffect(() => { void mobileReady().catch(() => {}); }, []);
  return null;
}

try {
  const reloading = import.meta.env.DEV && await disableDevelopmentServiceWorker({serviceWorker:navigator.serviceWorker,cacheStorage:window.caches,origin:window.location.origin,reload:()=>window.location.reload(),storage:window.sessionStorage});
  if (!reloading) {
    await initializeMobile();
    createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App />
        <MobileReady />
      </React.StrictMode>,
    );
  }
} catch {
  document.getElementById('root').textContent = '앱을 준비하지 못했습니다. Android System WebView와 저장 공간을 확인한 뒤 다시 실행해주세요. 저장된 주문은 삭제하지 않았습니다.';
}

if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[service-worker] registration failed', error);
    });
  });
}
