import { build as buildVite } from 'vite';
import { build as bundle } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('dist');
if (path.dirname(output) !== process.cwd() || path.basename(output) !== 'dist') throw new Error('Build output must stay in the project.');
await rm(output, { recursive: true, force: true });
await buildVite();
const root = path.resolve('dist/client');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const assets = {};
async function walk(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) await walk(file);
    else {
      const name = '/' + path.relative(root, file).split(path.sep).join('/');
      assets[name] = { type: types[path.extname(file)] || 'application/octet-stream', data: (await readFile(file)).toString('base64') };
    }
  }
}
await walk(root);
await mkdir('dist/server', { recursive: true });
const entry = `import {handleAPI} from './server/api.js';
const assets=${JSON.stringify(assets)};
const decoded=new Map();
export default {async fetch(req,env){
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')) return handleAPI(req,env);
  if(!['GET','HEAD'].includes(req.method)) return new Response('Method not allowed',{status:405});
  const name=url.pathname==='/'?'/index.html':url.pathname;
  const asset=assets[name];
  if(!asset)return new Response('Not found',{status:404});
  if(!decoded.has(name))decoded.set(name,Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)));
  return new Response(req.method==='HEAD'?null:decoded.get(name),{headers:{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Cache-Control':name==='/index.html'?'no-cache':'public, max-age=86400'}});
}};`;
await bundle({ stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: 'worker-entry.js' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js', minify: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json'));
console.log(`Worker and standalone static client built (${Object.keys(assets).length} embedded assets).`);
