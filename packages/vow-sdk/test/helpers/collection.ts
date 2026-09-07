import { ec, shortString } from 'starknet';
import type { ProbeConfiguration, ProbeSnapshot } from '../../src/probe-snapshot.ts';
import { POOL_CLASS_HASH } from '../../src/prepared-claim.ts';
import type { CollectionRequest } from '../../src/collection-wallet.ts';

export const syntheticKey = '0x123456';
export const config: ProbeConfiguration = {
  chainId: 1n, vaultAddress: 56n, probeClassHash: 1234n, poolAddress: 55n, token: 57n,
  supplierKey: BigInt(ec.starkCurve.getStarkKey(syntheticKey)), amount: 100n, claimBefore: 2000n,
  recipient: 333n, signatureDeadline: 1900n, feeToken: 88n, feeCollector: 99n, maximumFee: 10n,
};
export const snapshot: ProbeSnapshot = {
  chainId: 1n, blockHash: 123n, timestamp: 1000n, probeClassHash: 1234n, poolClassHash: POOL_CLASS_HASH,
  owner: 100n, poolAddress: 55n, token: 57n, supplierKey: config.supplierKey, amount: 100n, claimBefore: 2000n,
  state: 1n, balance: 100n, allowance: 0n, poolPaused: 0n, feeCollector: 99n,
};
export function prepared(request: CollectionRequest, changedNote = false) {
  if (request.type === 'wallet_supportedWalletApi') return ['0.10.3'];
  if (request.type === 'wallet_requestChainId') return '0x1';
  if (request.type !== 'wallet_strk20PrepareInvoke') throw new Error('TEST_UNEXPECTED_REQUEST');
  const action = request.params.actions[1];
  if (action?.type !== 'invoke') throw new Error('TEST_BAD_ACTION');
  const note = changedNote ? 778n : 777n;
  const invocationNote = action.calldata[2] === '${openNoteIds[0]}' ? note : BigInt(action.calldata[2]!);
  const actions = [
    [7n, 1n, 2n, 3n, 57n, note],
    [10n, 56n, 6n, BigInt(shortString.encodeShortString('CLAIM')), 1n, invocationNote, 1900n, BigInt(action.calldata[4]!), BigInt(action.calldata[5]!)],
    [3n, 99n, 88n, 10n],
  ];
  return { call: { contract_address: '0x37', entry_point: 'apply_actions', calldata: [3n, ...actions.flat(), 1n].map(String) },
    proof: request.params.simulate ? { data: '', output: [], proof_facts: [] } : { data: 'synthetic-not-a-real-proof', output: ['1'], proof_facts: ['2'] } };
}
