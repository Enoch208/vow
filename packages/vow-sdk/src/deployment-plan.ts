import { defaultDeployer, ec, hash } from 'starknet';
import type { Call } from 'starknet';
import { address, bounded, felt, U128_MAX, U64_MAX } from './integers.ts';
import type { ProbeConfiguration } from './probe-snapshot.ts';
import { validateProbeConfiguration } from './probe-snapshot.ts';

export interface ProbeDeploymentTerms extends Omit<ProbeConfiguration, 'vaultAddress'> {
  readonly owner: bigint;
  readonly salt: bigint;
  readonly principalLimit: bigint;
}

export interface ProbeDeploymentPlan {
  readonly status: 'preview-only';
  readonly predictedAddress: bigint;
  readonly constructorCalldata: readonly string[];
  readonly deploymentCall: Readonly<Call>;
  readonly fundingCalls: readonly Readonly<Call>[];
  readonly collectionConfiguration: Readonly<ProbeConfiguration>;
  readonly principal: bigint;
  readonly networkFees: 'not-estimated';
  readonly declaration: 'must-check-class-declaration';
  readonly reviewDigest: bigint;
}

export function buildProbeDeploymentPlan(terms: ProbeDeploymentTerms, now: bigint): ProbeDeploymentPlan {
  address(terms.owner, 'OWNER');
  felt(terms.salt, 'SALT', 1n);
  bounded(now, U64_MAX, 'NOW');
  bounded(terms.principalLimit, U128_MAX, 'PRINCIPAL_LIMIT', 1n);
  if (terms.amount > terms.principalLimit) throw new Error('VOW_PRINCIPAL_LIMIT');
  if (terms.chainId !== 0x534e5f4d41494en) throw new Error('VOW_WRONG_CHAIN');
  if (now >= terms.signatureDeadline || now >= terms.claimBefore) throw new Error('VOW_CLAIM_EXPIRED');
  const temporary = configuration(terms, 1n);
  validateProbeConfiguration(temporary);
  try { ec.starkCurve.getSharedSecret('1', `02${terms.supplierKey.toString(16).padStart(64, '0')}`); }
  catch { throw new Error('VOW_INVALID_SUPPLIER_KEY'); }
  const constructorCalldata = [terms.owner, terms.poolAddress, terms.token, terms.supplierKey, terms.amount, terms.claimBefore].map(hex);
  const deployment = defaultDeployer.buildDeployerCall({ classHash: hex(terms.probeClassHash), salt: hex(terms.salt), unique: true, constructorCalldata }, hex(terms.owner));
  if (deployment.calls.length !== 1 || deployment.addresses.length !== 1) throw new Error('VOW_INVALID_DEPLOYMENT');
  const predictedAddress = address(BigInt(deployment.addresses[0]!), 'PROBE');
  const deploymentCall = freezeCall(deployment.calls[0]!);
  const fundingCalls = Object.freeze([
    freezeCall({ contractAddress: hex(terms.token), entrypoint: 'approve', calldata: [hex(predictedAddress), hex(terms.amount), '0x0'] }),
    freezeCall({ contractAddress: hex(predictedAddress), entrypoint: 'fund', calldata: [] }),
  ]);
  const reviewDigest = BigInt(hash.computePoseidonHashOnElements([
    0x564f575f4445504c4f595f5631n, terms.chainId, terms.owner, terms.probeClassHash, terms.salt, predictedAddress,
    terms.poolAddress, terms.token, terms.supplierKey, terms.amount, terms.claimBefore, terms.recipient,
    terms.signatureDeadline, terms.feeToken, terms.feeCollector, terms.maximumFee, terms.principalLimit,
  ]));
  return Object.freeze({ status: 'preview-only', predictedAddress, constructorCalldata: Object.freeze(constructorCalldata), deploymentCall,
    fundingCalls, collectionConfiguration: Object.freeze(configuration(terms, predictedAddress)), principal: terms.amount,
    networkFees: 'not-estimated', declaration: 'must-check-class-declaration', reviewDigest });
}

function configuration(terms: ProbeDeploymentTerms, vaultAddress: bigint): ProbeConfiguration {
  return { chainId: terms.chainId, vaultAddress, probeClassHash: terms.probeClassHash, poolAddress: terms.poolAddress,
    token: terms.token, supplierKey: terms.supplierKey, amount: terms.amount, claimBefore: terms.claimBefore,
    recipient: terms.recipient, signatureDeadline: terms.signatureDeadline, feeToken: terms.feeToken,
    feeCollector: terms.feeCollector, maximumFee: terms.maximumFee };
}
function freezeCall(call: Call): Readonly<Call> {
  const copied = structuredClone(call);
  if (copied.calldata) Object.freeze(copied.calldata);
  return Object.freeze(copied);
}
function hex(value: bigint): string { return `0x${value.toString(16)}`; }
