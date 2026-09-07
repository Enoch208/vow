import { hash } from 'starknet';
import { createPublicReader } from '../packages/vow-sdk/src/probe-reader.ts';
import { PUBLIC_MAINNET_RPC } from '../packages/vow-sdk/src/rpc-endpoint.ts';

const VAULT = '0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227';
const result = await createPublicReader(PUBLIC_MAINNET_RPC).request('starknet_call', {
  request: {
    contract_address: VAULT, entry_point_selector: hash.getSelectorFromName('mandate'),
    calldata: ['0x2'],
  },
  block_id: 'latest',
}) as readonly string[];
process.stdout.write(`${BigInt(result[0]!) === 0n ? '0x0' : result[0]}\n`);
