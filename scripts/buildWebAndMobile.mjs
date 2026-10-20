import { spawnSync } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { loadEnv } from 'vite';

const env = loadEnv('android', process.cwd());
const version = process.env.VERCEL_GIT_COMMIT_SHA || `release-${Date.now()}`;
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
run(['scripts/packageMobileUpdate.mjs', version, env.VITE_MOBILE_API_ORIGIN]);
run(['node_modules/vite/bin/vite.js', 'build']);
await cp('mobile-release/mobile-updates', 'dist/mobile-updates', { recursive: true });
