import { defineConfig } from 'vite';
import { handleAPI } from './server/api.js';
import { localDatabase } from './server/local-db.js';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'local-room-server',
    configureServer(server) {
      const DB = localDatabase();
      server.httpServer?.once('close', () => DB.close());
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        try {
          let body = ''; for await (const chunk of req) body += chunk;
          const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(body ? { body } : {}) });
          const response = await handleAPI(request, { DB });
          res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
        } catch (error) { console.error(error); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Ошибка локального сервера.' })); }
      });
    },
  }],
  build: {
    target: 'es2022',
    outDir: 'dist/client',
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
