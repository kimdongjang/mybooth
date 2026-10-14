import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function createVercelApiDevPlugin() {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      server.middlewares.use('/api/auth', async (req, res) => {
        await runApiHandler(req, res, () => import('./api/auth.js'));
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

export default defineConfig({
  plugins: [createVercelApiDevPlugin(), react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
});