import { hash } from 'starknet';
import { address, felt } from './integers.ts';
import { walletRequest } from './collection-wallet.ts';
import type { CollectionWallet } from './collection-wallet.ts';

export async function connectAndReadAccountDeployment(wallet: CollectionWallet, expectedOwner: bigint, current: () => boolean = () => true, onConnected: () => void = () => {}) {
  address(expectedOwner, 'OWNER');
  const checkpoint = () => { if (!current()) throw new Error('VOW_SELECTION_CHANGED'); };
  checkpoint();
  const accounts = await walletRequest(wallet, { type: 'wallet_requestAccounts', params: { silent_mode: false, api_version: '0.10.3' } });
  checkpoint();
  if (!Array.isArray(accounts) || accounts.length !== 1 || scalar(accounts[0]) !== expectedOwner) throw new Error('VOW_WRONG_DEPLOYMENT_ACCOUNT');
  onConnected(); checkpoint();
  const chain = await walletRequest(wallet, { type: 'wallet_requestChainId' });
  checkpoint();
  if (chain !== '0x534e5f4d41494e') throw new Error('VOW_WRONG_WALLET_CHAIN');
  const data = await walletRequest(wallet, { type: 'wallet_deploymentData', params: { api_version: '0.10.3' } });
  checkpoint();
  return validateAccountDeployment(data, expectedOwner);
}

export function validateAccountDeployment(input: unknown, expectedOwner: bigint) {
  address(expectedOwner, 'OWNER');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VOW_INVALID_ACCOUNT_DEPLOYMENT');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['address', 'class_hash', 'salt', 'calldata', 'sigdata', 'version'].includes(key))) throw new Error('VOW_INVALID_ACCOUNT_DEPLOYMENT');
  const owner = scalar(data.address); const classHash = felt(scalar(data.class_hash), 'CLASS', 1n); const salt = scalar(data.salt);
  if (owner !== expectedOwner) throw new Error('VOW_WRONG_DEPLOYMENT_ACCOUNT');
  if (data.version !== 0 && data.version !== 1) throw new Error('VOW_INVALID_ACCOUNT_DEPLOYMENT');
  if (!Array.isArray(data.calldata) || data.calldata.length > 256) throw new Error('VOW_INVALID_ACCOUNT_DEPLOYMENT');
  const calldata = data.calldata.map((value: unknown) => hex(scalar(value)));
  const predicted = BigInt(hash.calculateContractAddressFromHash(hex(salt), hex(classHash), calldata, '0x0'));
  if (predicted !== owner) throw new Error('VOW_ACCOUNT_ADDRESS_MISMATCH');
  return Object.freeze({ address: hex(owner), class_hash: hex(classHash), salt: hex(salt), calldata: Object.freeze(calldata), version: data.version,
    addressVerified: true, signatureDataOmitted: true });
}

function scalar(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) throw new Error('VOW_INVALID_ACCOUNT_DEPLOYMENT');
  return felt(BigInt(value), 'DEPLOYMENT_FELT');
}
function hex(value: bigint): string { return `0x${value.toString(16)}`; }
