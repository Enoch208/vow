import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { hash } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { build } from 'esbuild';

const contract = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
const casm = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.compiled_contract_class.json', 'utf8')) as CompiledSierraCasm;
const classHash = hash.computeContractClassHash(contract);
const starknetVersion = '0.14.3';
await mkdir('dist/collection', { recursive: true });
await build({ entryPoints: ['scripts/collection/browser.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023',
  outfile: 'dist/collection/browser.js', minify: true, legalComments: 'none', define: { PROBE_CLASS_HASH: JSON.stringify(classHash) } });
await writeFile('dist/collection/build.json', JSON.stringify({ contract: 'CollectionProbe', classHash, deployed: false }, null, 2) + '\n');
process.stdout.write(`Collection workbench built for probe class ${classHash}. No deployment performed.\n`);

await build({ entryPoints: ['scripts/supplier/browser.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023', outfile: 'dist/supplier/browser.js', minify: true, legalComments: 'none' });
await build({ entryPoints: ['scripts/activation/browser.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023', outfile: 'dist/activation/browser.js', minify: true, legalComments: 'none' });

await build({ entryPoints: ['scripts/deployment/browser.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023', outfile: 'dist/deployment/browser.js', minify: true, legalComments: 'none',
  define: { PROBE_CLASS_HASH: JSON.stringify(classHash), COMPILED_CLASS_HASH: JSON.stringify(hash.computeCompiledClassHash(casm, starknetVersion)) } });
await writeFile('dist/deployment/contract.json', JSON.stringify({ classHash, compiledClassHash: hash.computeCompiledClassHash(casm, starknetVersion), starknetVersion,
  contractClass: contract }) + '\n');
