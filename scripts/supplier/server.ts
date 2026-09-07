import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = new Map([
  ['/', ['scripts/supplier/index.html', 'text/html; charset=utf-8']],
  ['/browser.js', ['dist/supplier/browser.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['scripts/collection/style.css', 'text/css; charset=utf-8']],
]);
export function createSupplierServer() {
  return createServer(async (request, response) => {
    const address = response.socket?.address();
    const port = address && 'port' in address ? address.port : 0;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host ?? '')) { response.writeHead(403).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const asset = assets.get(request.url ?? '');
    if (!asset) { response.writeHead(404).end(); return; }
    try {
      const content = await readFile(resolve(root, asset[0]!));
      response.writeHead(200, { 'content-type': asset[1]! }).end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(503).end('Run npm run build:workbench first.'); }
  });
}
