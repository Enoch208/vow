import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PUBLIC_MAINNET_RPC } from '../../packages/vow-sdk/src/rpc-endpoint.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const importMap = '{"imports":{"@wallet-standard/app":"/vendor/wallets.js"}}';
const importHash = createHash('sha256').update(importMap).digest('base64');
const connected = (url: string) => ['/owner', '/operator'].includes(url) || /^\/claim\/(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(url) || /^\/verify(?:\/(?:0x[0-9a-fA-F]+|[0-9]+))?$/.test(url);
const assets = new Map([
  ['/', ['scripts/app/index.html', 'text/html; charset=utf-8']],
  ['/owner', ['scripts/app/owner.html', 'text/html; charset=utf-8']],
  ['/operator', ['scripts/app/operator.html', 'text/html; charset=utf-8']],
  ['/app.css', ['scripts/app/app.css', 'text/css; charset=utf-8']],
  ['/owner.js', ['dist/app/owner.js', 'text/javascript; charset=utf-8']],
  ['/operator.js', ['dist/app/operator.js', 'text/javascript; charset=utf-8']],
  ['/app/browser.js', ['dist/app/browser.js', 'text/javascript; charset=utf-8']],
  ['/app/style.css', ['scripts/app/style.css', 'text/css; charset=utf-8']],
  ['/app/deployment.json', ['dist/app/deployment.json', 'application/json']],
  ['/vendor/wallets.js', ['node_modules/@wallet-standard/app/lib/esm/wallets.js', 'text/javascript; charset=utf-8']],
  ['/deployment/manifest.json', ['dist/deployment/manifest.json', 'application/json']],
  ['/evidence/claims.json', ['evidence/claims.json', 'application/json']],
  ['/docs/README.md', ['README.md', 'text/plain; charset=utf-8']],
  ['/docs/JUDGES.md', ['JUDGES.md', 'text/plain; charset=utf-8']],
  ['/docs/THREAT_MODEL.md', ['THREAT_MODEL.md', 'text/plain; charset=utf-8']],
  ['/docs/PRIVACY.md', ['PRIVACY.md', 'text/plain; charset=utf-8']],
  ['/docs/REPRODUCE.md', ['REPRODUCE.md', 'text/plain; charset=utf-8']],
]);

export function createAppServer() {
  const server = createServer(async (request, response) => {
    const bound = server.address();
    const port = bound && typeof bound === 'object' ? bound.port : 0;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const connect = connected(request.url ?? '') ? `'self' ${PUBLIC_MAINNET_RPC}` : "'none'";
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'sha256-${importHash}'; style-src 'self'; connect-src ${connect}; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '')) {
      response.writeHead(403).end('Forbidden host'); return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.writeHead(405).end('Read-only server'); return;
    }
    const url = request.url ?? '';
    const collectionPage = /^\/claim\/(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(url) || /^\/verify(?:\/(?:0x[0-9a-fA-F]+|[0-9]+))?$/.test(url);
    const resource = collectionPage ? ['scripts/app/collection.html', 'text/html; charset=utf-8'] : assets.get(url);
    if (!resource) { response.writeHead(404).end('Not found'); return; }
    try {
      const data = await readFile(resolve(root, resource[0]!));
      response.setHeader('Content-Type', resource[1]!);
      response.writeHead(200).end(request.method === 'HEAD' ? undefined : data);
    } catch {
      if (request.url === '/deployment/manifest.json') {
        response.writeHead(404).end('No VowVault deployment manifest. Every write flow stays blocked until one exists.'); return;
      }
      response.writeHead(503).end('Run npm run build:workbench before starting the product screens.');
    }
  });
  return server;
}
