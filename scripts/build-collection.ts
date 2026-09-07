import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { defaultDeployer, hash } from 'starknet';
import type { CompiledSierra, CompiledSierraCasm } from 'starknet';
import { build } from 'esbuild';

const contract = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.contract_class.json', 'utf8')) as CompiledSierra;
const casm = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_CollectionProbe.compiled_contract_class.json', 'utf8')) as CompiledSierraCasm;
const appVault = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 'utf8')) as CompiledSierra;
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

const chainId = '0x534e5f4d41494e';
const poolAddress = '0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';
const poolClassHash = '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d';
const owner = '0x5282ba58af3296b7c6bdb51dfb12789cbf4603799e7fc8baef6a9704de1679e';
const appVaultClassHash = hash.computeContractClassHash(appVault);
const predictedVault = defaultDeployer.buildDeployerCall({ classHash: appVaultClassHash, salt: '0x564f575f5641554c545f5631', unique: true,
  constructorCalldata: [poolAddress] }, owner).addresses[0]!;
await mkdir('dist/app', { recursive: true });
await build({ entryPoints: ['scripts/app/browser.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023', outfile: 'dist/app/browser.js', minify: true, legalComments: 'none' });
await writeFile('dist/app/deployment.json', JSON.stringify({ schemaVersion: 1, status: 'not-deployed', deployment: {
  chainId, vaultAddress: predictedVault, vaultClassHash: appVaultClassHash, poolAddress, poolClassHash,
  feeToken: '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  feeCollector: '0xd79041634625e5288296fbc648088788710ba44903a3a49468a66567749e77', maximumProtocolFee: '6000000000000000000', maximumNetworkFee: '0',
}, tokens: [{ address: '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', symbol: 'STRK', decimals: 18 }],
preloadedTransactionHash: '0x39db0c00d44f27f2e22f02abad354fc93c32a8202b04e41291a990554d49d1e',
evidence: 'Real successful mainnet negative control; unrelated to VOW and required to be rejected.' }, null, 2) + '\n');

const vault = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_VowVault.contract_class.json', 'utf8')) as CompiledSierra;
const vaultCasm = JSON.parse(await readFile('contracts/target/dev/vow_collection_probe_VowVault.compiled_contract_class.json', 'utf8')) as CompiledSierraCasm;
const vaultClassHash = hash.computeContractClassHash(vault);
const vaultCompiledClassHash = hash.computeCompiledClassHash(vaultCasm, starknetVersion);
await writeFile('dist/deployment/vault.json', JSON.stringify({ classHash: vaultClassHash, compiledClassHash: vaultCompiledClassHash, starknetVersion,
  contractClass: vault }) + '\n');
process.stdout.write(`VowVault class ${vaultClassHash} compiled ${vaultCompiledClassHash}. No declaration or deployment performed.\n`);

for (const screen of ['owner', 'operator']) {
  await build({ entryPoints: [`scripts/app/${screen}-browser.ts`], bundle: true, platform: 'browser', format: 'esm', target: 'es2023',
    outfile: `dist/app/${screen}.js`, minify: true, legalComments: 'none', define: { VAULT_CLASS_HASH: JSON.stringify(vaultClassHash) } });
}
process.stdout.write(`Owner and operator screens built against VowVault class ${vaultClassHash}. No deployment manifest is shipped.\n`);

await mkdir('dist/vault', { recursive: true });
await build({ entryPoints: ['scripts/vault/browser.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023',
  outfile: 'dist/vault/browser.js', minify: true, legalComments: 'none' });
const { sierra_program_debug_info: _vaultDebug, ...vaultDeclarable } = vault as CompiledSierra & { sierra_program_debug_info?: unknown };
if (hash.computeContractClassHash(vaultDeclarable) !== vaultClassHash) throw new Error('VOW_VAULT_CLASS_HASH_DRIFT');
await writeFile('dist/vault/contract.json', JSON.stringify({ classHash: vaultClassHash, compiledClassHash: vaultCompiledClassHash, starknetVersion,
  contractClass: vaultDeclarable }) + '\n');
