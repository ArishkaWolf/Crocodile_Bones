import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAPI } from './api.js';
import { localDatabase } from './local-db.js';

const ROOT = fileURLToPath(new URL('../dist/client/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };

export function createGameServer({ database, databasePath = process.env.ROOM_DB_PATH || '.local/rooms.sqlite', clientRoot = ROOT } = {}) {
  const DB = database || localDatabase(databasePath);
  const root = path.resolve(clientRoot);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://game.local');
      if (url.pathname.startsWith('/api/')) {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) { res.writeHead(413, { ...HEADERS, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Слишком большой запрос.' })); return; }
          chunks.push(chunk);
        }
        const content = Buffer.concat(chunks);
        const request = new Request(url, { method: req.method, headers: req.headers, ...(content.length ? { body: content } : {}) });
        const response = await handleAPI(request, { DB });
        res.writeHead(response.status, { ...HEADERS, ...Object.fromEntries(response.headers) });
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, HEADERS); res.end(); return; }
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(root, '.' + pathname);
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || pathname.includes('\0')) { res.writeHead(404, HEADERS); res.end('Not found'); return; }
      if (!(await stat(file)).isFile()) { res.writeHead(404, HEADERS); res.end('Not found'); return; }
      const data = await readFile(file);
      res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': path.basename(file) === 'index.html' ? 'no-cache' : 'public, max-age=86400' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 500, { ...HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.code === 'ENOENT' ? 'Не найдено.' : 'Сервер временно недоступен.' }));
    }
  });
  server.once('close', () => { if (!database) DB.close(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createGameServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => console.log(`Кости Крокодила: http://localhost:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
}
