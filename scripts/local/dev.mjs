import { registerHooks } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

for (const key of Object.keys(process.env)) {
  if (/^(POSTGRES_|DATABASE_URL$|BLOB_|ADMIN_|AUTH_SECRET$|VITE_)/.test(key)) delete process.env[key];
}
process.env.POS_LOCAL_DB = '1';
// Satisfy the existing API configuration guard; the module hook handles all SQL.
process.env.POSTGRES_URL = 'postgres://local-only';
await mkdir('.local-data', { recursive: true });
try { await writeFile('.local-data/auth-secret', randomBytes(32).toString('hex'), { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
process.env.AUTH_SECRET = (await readFile('.local-data/auth-secret', 'utf8')).trim();
const adapter = new URL('./postgres.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@vercel/postgres') return { url: adapter, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { createServer } = await import('vite');
const server = await createServer({ mode: 'localdb', configLoader: 'runner' });
await server.listen();
server.printUrls();
