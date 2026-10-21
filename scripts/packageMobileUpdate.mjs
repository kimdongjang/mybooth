import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { httpsOrigin, NATIVE_CONTRACT } from '../src/platform/mobileConfig.js';

const [version, server] = process.argv.slice(2);
if (!version || !/^[a-zA-Z0-9._-]{1,100}$/.test(version) || !server) {
  throw new Error('Usage: npm run android:bundle -- <unique-version> https://your-api-origin');
}
const origin = httpsOrigin(server);
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'android'], {
  stdio: 'inherit', env: { ...process.env, VITE_MOBILE_API_ORIGIN: origin },
});
if (result.status !== 0) process.exit(result.status || 1);
const root = resolve('dist');
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) {
      const name = relative(root, path).replaceAll('\\', '/');
      // Native updates must not carry a web service worker or its independent cache.
      if (name !== 'sw.js') files[name] = new Uint8Array(await readFile(path));
    }
  }
}
await collect(root);
if (!files['index.html']) throw new Error('Missing index.html');
const archive = zipSync(files);
const gradle = await readFile('android/app/build.gradle', 'utf8');
const nativeVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
if (!nativeVersion) throw new Error('Cannot read Android versionName');
const directory = resolve('mobile-release/mobile-updates');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, `${version}.zip`), archive);
await writeFile(resolve(directory, 'latest.json'), JSON.stringify({
  version, nativeContract: NATIVE_CONTRACT, nativeVersion,
  url: `${origin}/mobile-updates/${version}.zip`,
  checksum: createHash('sha256').update(archive).digest('hex'),
}, null, 2) + '\n');
console.log(`Prepared mobile-release/mobile-updates/${version}.zip and latest.json. Upload ZIP first, manifest last.`);
