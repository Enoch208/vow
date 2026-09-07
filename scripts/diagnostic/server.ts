import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const importMap = '{"imports":{"@wallet-standard/app":"/vendor/wallets.js"}}';
const importHash = createHash('sha256').update(importMap).digest('base64');
const assets = new Map([
  ['/deployment', ['scripts/deployment/index.html', 'text/html; charset=utf-8']],
  ['/deployment/draft.json', ['dist/deployment/draft.json', 'application/json']],
  ['/deployment/contract.json', ['dist/deployment/contract.json', 'application/json']],
  ['/deployment/budget.json', ['dist/deployment/budget.json', 'application/json']],
  ['/deployment/browser.js', ['dist/deployment/browser.js', 'text/javascript; charset=utf-8']],
  ['/vault', ['scripts/vault/index.html', 'text/html; charset=utf-8']],
  ['/vault/browser.js', ['dist/vault/browser.js', 'text/javascript; charset=utf-8']],
  ['/vault/contract.json', ['dist/vault/contract.json', 'application/json']],
  ['/vault/draft.json', ['dist/vault/draft.json', 'application/json']],
  ['/activation', ['scripts/activation/index.html', 'text/html; charset=utf-8']],
  ['/activation/browser.js', ['dist/activation/browser.js', 'text/javascript; charset=utf-8']],
  ['/collection', ['scripts/collection/index.html', 'text/html; charset=utf-8']],
  ['/collection/browser.js', ['dist/collection/browser.js', 'text/javascript; charset=utf-8']],
  ['/collection/style.css', ['scripts/collection/style.css', 'text/css; charset=utf-8']],
  ['/collection/build.json', ['dist/collection/build.json', 'application/json']],
  ['/collection/budget.json', ['dist/collection/budget.json', 'application/json']],
  ['/', ['scripts/diagnostic/index.html', 'text/html; charset=utf-8']],
  ['/diagnostic.css', ['scripts/diagnostic/diagnostic.css', 'text/css; charset=utf-8']],
  ['/scripts/diagnostic/browser.js', ['dist/scripts/diagnostic/browser.js', 'text/javascript; charset=utf-8']],
  ['/packages/vow-sdk/src/wallet.js', ['dist/packages/vow-sdk/src/wallet.js', 'text/javascript; charset=utf-8']],
  ['/packages/vow-sdk/src/wallet-discovery.js', ['dist/packages/vow-sdk/src/wallet-discovery.js', 'text/javascript; charset=utf-8']],
  ['/vendor/wallets.js', ['node_modules/@wallet-standard/app/lib/esm/wallets.js', 'text/javascript; charset=utf-8']],
]);

export function createDiagnosticServer() {
  const server = createServer(async (request, response) => {
    const bound = server.address();
    const port = bound && typeof bound === 'object' ? bound.port : 0;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const connect = ['/collection', '/deployment', '/vault'].includes(request.url ?? '') ? `'self' ${PUBLIC_MAINNET_RPC}` : "'none'";
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'sha256-${importHash}'; style-src 'self'; connect-src ${connect}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host ?? '')) {
      response.writeHead(403).end('Forbidden host'); return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.writeHead(405).end('Read-only server'); return;
    }
    const resource = assets.get(request.url ?? '');
    if (!resource) { response.writeHead(404).end('Not found'); return; }
    try {
      const data = await readFile(resolve(root, resource[0]!));
      response.setHeader('Content-Type', resource[1]!);
      response.writeHead(200).end(request.method === 'HEAD' ? undefined : data);
    } catch {
      if (request.url === '/collection/budget.json') { response.writeHead(404).end('No approved collection budget.'); return; }
      response.writeHead(503).end('Run npm run build before starting the diagnostic.');
    }
  });
  return server;
}
