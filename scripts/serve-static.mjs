// Serves a folder as a static site for previewing the demo build: node scripts/serve-static.mjs site 4478
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'site');
const port = Number(process.argv[3] ?? 4478);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://localhost:${port}`));
