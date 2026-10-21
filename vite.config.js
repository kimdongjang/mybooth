import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { httpsOrigin } from './src/platform/mobileConfig.js';

function createVercelApiDevPlugin() {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      server.middlewares.use('/api/auth', async (req, res) => {
        await runApiHandler(req, res, () => import('./api/auth.js'));
      });
      server.middlewares.use('/api/product-images', async (req, res) => {
        await runApiHandler(req, res, () => import('./api/product-images.js'));
      });
      server.middlewares.use('/api/settlements', async (req, res) => {
        await runApiHandler(req, res, () => import('./api/settlements.js'));
      });
      server.middlewares.use('/api/pos', async (req, res) => {
        await runApiHandler(req, res, () => import('./api/pos.js'));
      });
    },
  };
}

async function runApiHandler(req, res, loadHandler) {
  try {
    req.query = Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams.entries());
    req.body = await readJsonBody(req);

    const response = createResponseAdapter(res);
    const mod = await loadHandler();
    await mod.default(req, response);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error.message || '로컬 API 처리에 실패했습니다.' }));
    }
  }
}

function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve({});
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function createResponseAdapter(res) {
  return {
    get headersSent() { return res.headersSent; },
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(payload) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
      return this;
    },
  };
}

export default defineConfig(({ mode, command }) => {
  if (command === 'serve') {
    const env = loadEnv(mode, process.cwd(), '');
    // Pass only server credentials to Node; Vite's client env prefix stays unchanged.
    for (const key of ['ADMIN_ID', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'AUTH_SECRET', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL', 'BLOB_READ_WRITE_TOKEN']) {
      if (process.env[key] === undefined && env[key] !== undefined) process.env[key] = env[key];
    }
  }
  return ({
  build: { target: 'es2022' },
  plugins: [createVercelApiDevPlugin(), react(), tailwindcss(), {
    name: 'validate-mobile-origin',
    configResolved(config) {
      if (mode === 'android') {
        const value = config.env.VITE_MOBILE_API_ORIGIN;
        if (!value || new URL(httpsOrigin(value)).hostname === 'localhost') throw new Error('Set VITE_MOBILE_API_ORIGIN to the public HTTPS API origin before building Android.');
      }
    },
  }],
  server: {
    port: 4173,
    host: '127.0.0.1',
    strictPort: true,
  },
});
});
