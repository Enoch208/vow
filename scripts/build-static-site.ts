import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist/site');

const files: readonly (readonly [string, string])[] = [
  ['scripts/app/index.html', 'demo/dashboard/index.html'],
  ['scripts/app/owner.html', 'owner/index.html'],
  ['scripts/app/operator.html', 'operator/index.html'],
  ['scripts/app/collection.html', 'claim/index.html'],
  ['scripts/app/collection.html', 'verify/index.html'],
  ['scripts/app/app.css', 'app.css'],
  ['scripts/app/style.css', 'app/style.css'],
  ['scripts/app/favicon.svg', 'favicon.svg'],
  ['dist/app/owner.js', 'owner.js'],
  ['dist/app/operator.js', 'operator.js'],
  ['dist/app/browser.js', 'app/browser.js'],
  ['dist/app/deployment.json', 'app/deployment.json'],
  ['node_modules/@wallet-standard/app/lib/esm/wallets.js', 'vendor/wallets.js'],
  ['evidence/claims.json', 'evidence/claims.json'],
  ['README.md', 'docs/README.md'],
  ['JUDGES.md', 'docs/JUDGES.md'],
  ['THREAT_MODEL.md', 'docs/THREAT_MODEL.md'],
  ['PRIVACY.md', 'docs/PRIVACY.md'],
  ['REPRODUCE.md', 'docs/REPRODUCE.md'],
];

const optional = new Set(['dist/deployment/manifest.json']);

async function copy(source: string, target: string): Promise<boolean> {
  try {
    const data = await readFile(resolve(root, source));
    const destination = resolve(out, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);
    return true;
  } catch {
    return false;
  }
}

await rm(out, { recursive: true, force: true });
await cp(resolve(root, 'web/out'), out, { recursive: true });
const missing: string[] = [];
for (const [source, target] of files) {
  if (!await copy(source, target)) missing.push(source);
}

const manifestCopied = await copy('dist/deployment/manifest.json', 'deployment/manifest.json');
await writeFile(resolve(out, '.nojekyll'), '');

if (missing.length > 0) {
  process.stderr.write(`Missing required assets: ${missing.join(', ')}\n`);
  process.stderr.write('Run npm run build:workbench first.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Landing site and ${files.length} product assets written to dist/site.\n`);
  process.stdout.write(
    manifestCopied
      ? 'A VowVault deployment manifest was included.\n'
      : 'No deployment manifest exists yet, so every write flow stays blocked in the published site.\n',
  );
  for (const path of optional) {
    if (!manifestCopied) process.stdout.write(`Absent: ${path}\n`);
  }
}
