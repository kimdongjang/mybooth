export const NATIVE_CONTRACT = 1;

export function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('앱 서버 주소는 경로 없는 HTTPS origin이어야 합니다.');
  }
  return url.origin;
}

export function apiTarget(input, origin, localOrigin) {
  const url = new URL(input, `${localOrigin}/`);
  return url.origin === localOrigin && url.pathname.startsWith('/api/')
    ? `${origin}${url.pathname}${url.search}` : input;
}

export function validUpdate(manifest, origin, nativeVersion) {
  if (!manifest || manifest.nativeContract !== NATIVE_CONTRACT || manifest.nativeVersion !== nativeVersion ||
      typeof manifest.version !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(manifest.version) ||
      !/^[a-f0-9]{64}$/.test(manifest.checksum)) return false;
  try {
    const url = new URL(manifest.url);
    return url.origin === origin && !url.username && !url.password && url.pathname.startsWith('/mobile-updates/') && url.pathname.endsWith('.zip');
  } catch { return false; }
}
