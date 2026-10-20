import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as config from '../src/platform/mobileConfig.js';

async function boot({ native = true, local = new Map(), downloadFails = false } = {}) {
  const session = new Map();
  const calls = [];
  const listeners = {};
  let manifest = { nativeContract: 1, nativeVersion: '1.0', version: 'release-2', checksum: 'a'.repeat(64), url: 'https://pos.example/mobile-updates/release-2.zip' };
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
  const context = vm.createContext({
    URL, Event, AbortSignal, localStorage: storage(local), sessionStorage: storage(session),
    location: { origin: 'https://localhost' }, navigator: { onLine: true, locks: {} },
  });
  context.window = {
    fetch: async (url, options) => { calls.push(['fetch', url, options]); return { ok: true, json: async () => manifest }; },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    dispatchEvent: event => calls.push(['event', event.type]),
  };
  context.fetch = (...args) => context.window.fetch(...args);
  const updater = {
    notifyAppReady: async () => calls.push(['ready']),
    current: async () => ({ bundle: { version: 'builtin' } }),
    list: async () => ({ bundles: [] }),
    download: async options => { calls.push(['download', options]); if (downloadFails) throw Error('connection lost'); return { id: 'new-bundle' }; },
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
  return { app: module.namespace, session, local, calls, listeners, window: context.window, setManifest: value => { manifest = value; } };
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

test('OTA download is deferred until process restart and failed downloads never activate', async () => {
  for (const downloadFails of [false, true]) {
    const runtime = await boot({ downloadFails });
    await runtime.app.mobileReady();
    // The launch check is fire-and-forget; the connectivity callback awaits completion.
    await new Promise(resolve => setImmediate(resolve));
    const actions = runtime.calls.map(call => call[0]);
    assert.ok(actions.includes('ready'));
    assert.ok(actions.includes('download'));
    assert.equal(actions.includes('next'), !downloadFails);
    if (!downloadFails) assert.equal(runtime.calls.find(call => call[0] === 'delay')[1].delayConditions[0].kind, 'kill');
  }
});
