import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as config from '../src/platform/mobileConfig.js';

async function boot({ native = true, local = new Map(), downloadFails = false, online = true, currentVersion = 'builtin', bundles = [], download, apply, fetchFails = false, manualTimer = false, setFails = false } = {}) {
  const session = new Map();
  const calls = [];
  const listeners = {};
  let expire;
  let manifest = { nativeContract: 1, nativeVersion: '1.0', version: 'release-2', checksum: 'a'.repeat(64), url: 'https://pos.example/mobile-updates/release-2.zip' };
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
  const context = vm.createContext({
    URL, Event, AbortSignal, localStorage: storage(local), sessionStorage: storage(session),
    setTimeout: manualTimer ? callback => { expire = callback; return 1; } : setTimeout,
    clearTimeout: manualTimer ? () => {} : clearTimeout,
    location: { origin: 'https://localhost' }, navigator: { onLine: online, locks: {} },
  });
  context.window = {
    fetch: async (url, options) => { calls.push(['fetch', url, options]); if (fetchFails) throw Error('offline'); return { ok: true, json: async () => manifest }; },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    dispatchEvent: event => calls.push(['event', event.type]),
  };
  context.fetch = (...args) => context.window.fetch(...args);
  const updater = {
    notifyAppReady: async () => calls.push(['ready']),
    current: async () => ({ bundle: { version: currentVersion } }),
    list: async () => ({ bundles }),
    download: async options => { calls.push(['download', options]); if (downloadFails) throw Error('connection lost'); return download ? download() : { id: 'new-bundle' }; },
    set: async options => { calls.push(['set', options]); if (setFails) throw Error('invalid bundle'); if (apply) await apply(); },
    setMultiDelay: async options => calls.push(['delay', options]),
    next: async options => calls.push(['next', options]),
  };
  const modules = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native } },
    '@capacitor/app': { App: { getInfo: async () => ({ version: '1.0' }), addListener: async (name, callback) => { listeners[name] = callback; } } },
    '@capgo/capacitor-updater': { CapacitorUpdater: updater },
    '../database/dexie': { db: { open: async () => calls.push(['db-open']) } },
    './mobileConfig': config,
  };
  const module = new vm.SourceTextModule(await readFile(new URL('../src/platform/mobile.js', import.meta.url), 'utf8'), {
    context, initializeImportMeta(meta) { meta.env = { VITE_MOBILE_API_ORIGIN: 'https://pos.example' }; },
  });
  await module.link(name => new vm.SyntheticModule(Object.keys(modules[name]), function () {
    for (const [key, value] of Object.entries(modules[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  return { app: module.namespace, session, local, calls, listeners, window: context.window, expire: () => expire(), setOnline: value => { context.navigator.onLine = value; }, setManifest: value => { manifest = value; } };
}

test('native cold boot restores session and account-scoped project cache without changing browser sessions', async () => {
  const first = await boot();
  await first.app.initializeMobile();
  first.app.sessionStore.setItem('pos_admin_token', 'token');
  first.app.sessionStore.setItem('pos_admin_id', 'admin');
  first.app.sessionStore.setItem('pos_selected_project_id', 'event');
  first.app.saveProjectList('admin', [{ id: 'event' }]);
  const restarted = await boot({ local: first.local });
  await restarted.app.initializeMobile();
  assert.equal(restarted.session.get('pos_selected_project_id'), 'event');
  assert.equal(restarted.session.get('pos_admin_token'), 'token');
  assert.equal(restarted.app.readProjectList('other-admin'), null);
  assert.equal(restarted.app.readProjectList('admin')[0].id, 'event');
  await restarted.window.fetch('/api/pos?projectId=event');
  assert.equal(restarted.calls.at(-1)[1], 'https://pos.example/api/pos?projectId=event');
  restarted.listeners.appStateChange({ isActive: true });
  assert.deepEqual(restarted.calls.at(-1), ['event', 'online']);
  for (const key of ['pos_admin_token', 'pos_admin_id', 'pos_selected_project_id']) restarted.app.sessionStore.removeItem(key);
  const loggedOut = await boot({ local: first.local });
  await loggedOut.app.initializeMobile();
  assert.equal(loggedOut.session.get('pos_admin_token'), undefined);
  const browser = await boot({ native: false, local: first.local });
  await browser.app.initializeMobile();
  assert.equal(browser.calls.length, 0);
  assert.equal(browser.app.readProjectList('admin'), null);
});

test('OTA startup applies the latest bundle immediately and shares the StrictMode readiness check', async () => {
  const runtime = await boot();
  await runtime.app.initializeMobile();
  const first = runtime.app.mobileReady();
  assert.equal(runtime.app.mobileReady(), first);
  assert.equal(await first, true);
  const actions = runtime.calls.map(call => call[0]);
  assert.ok(actions.indexOf('db-open') < actions.indexOf('ready'));
  assert.ok(actions.indexOf('ready') < actions.indexOf('download'));
  assert.ok(actions.includes('set'));
  assert.equal(actions.includes('next'), false);
  assert.equal(runtime.calls.find(call => call[0] === 'fetch')[2].cache, 'no-store');
});

test('OTA offline and failed startup checks retain the current bundle and session', async () => {
  for (const options of [{ online: false }, { fetchFails: true }, { downloadFails: true }, { setFails: true }]) {
    const runtime = await boot(options);
    await runtime.app.initializeMobile();
    runtime.app.sessionStore.setItem('pos_admin_token', 'saved-token');
    assert.ok(!await runtime.app.mobileReady());
    assert.equal(runtime.app.sessionStore.getItem('pos_admin_token'), 'saved-token');
    assert.equal(runtime.calls.some(call => call[0] === 'next'), false);
  }
});

test('OTA reuses pending bundles and skips current, failed and incompatible releases', async () => {
  const cached = await boot({ bundles: [{ id: 'cached', version: 'release-2', status: 'pending' }] });
  assert.equal(await cached.app.mobileReady(), true);
  assert.equal(cached.calls.some(call => call[0] === 'download'), false);
  assert.equal(cached.calls.find(call => call[0] === 'set')[1].id, 'cached');
  for (const options of [{ currentVersion: 'release-2' }, { bundles: [{ version: 'release-2', status: 'error' }] }, {}]) {
    const runtime = await boot(options);
    if (!Object.keys(options).length) runtime.setManifest({ nativeContract: 2 });
    assert.ok(!await runtime.app.mobileReady());
    assert.equal(runtime.calls.some(call => ['download', 'set', 'next'].includes(call[0])), false);
  }
});

test('OTA slow startup releases the screen and only stages late downloads for restart', async () => {
  let finish;
  const runtime = await boot({ manualTimer: true, download: () => new Promise(resolve => { finish = resolve; }) });
  const starting = runtime.app.mobileReady();
  await new Promise(resolve => setImmediate(resolve));
  runtime.expire();
  assert.equal(await starting, false);
  finish({ id: 'late-bundle' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.calls.some(call => call[0] === 'set'), false);
  assert.equal(runtime.calls.find(call => call[0] === 'next')[1].id, 'late-bundle');
});

test('OTA startup timeout never opens sales after a native bundle switch has begun', async () => {
  let finish;
  let enteredSales = false;
  const runtime = await boot({ manualTimer: true, apply: () => new Promise(resolve => { finish = resolve; }) });
  const starting = runtime.app.mobileReady().then(reloading => { enteredSales = !reloading; return reloading; });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(runtime.calls.some(call => call[0] === 'set'));
  runtime.expire();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enteredSales, false);
  // The real plugin destroys JS here; resolve the mock to finish the test.
  finish();
  assert.equal(await starting, true);
});

test('OTA connectivity recovery stages updates without interrupting sales and failures never activate', async () => {
  for (const downloadFails of [false, true]) {
    const runtime = await boot({ downloadFails, online: false });
    await runtime.app.mobileReady();
    runtime.setOnline(true);
    await runtime.listeners.online();
    const actions = runtime.calls.map(call => call[0]);
    assert.ok(actions.includes('ready'));
    assert.ok(actions.includes('download'));
    assert.equal(actions.includes('next'), !downloadFails);
    assert.equal(actions.includes('set'), false);
    if (!downloadFails) assert.equal(runtime.calls.find(call => call[0] === 'delay')[1].delayConditions[0].kind, 'kill');
  }
});
