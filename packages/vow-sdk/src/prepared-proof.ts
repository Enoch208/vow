import { felt } from './integers.ts';

export interface PreparedCollection {
  readonly call: { readonly contract_address: string; readonly entry_point: string; readonly calldata: string[] };
  readonly proof: { readonly data: string; readonly output: string[]; readonly proof_facts: string[] };
}

export function retainPreparedProof(input: unknown): PreparedCollection {
  if (!input || typeof input !== 'object' || !('call' in input) || !('proof' in input)) throw new Error('VOW_INVALID_PROOF');
  const proof = input.proof;
  const call = input.call;
  if (!proof || typeof proof !== 'object' || !('data' in proof) || !('output' in proof) || !('proof_facts' in proof)) throw new Error('VOW_INVALID_PROOF');
  if (typeof proof.data !== 'string' || proof.data.length === 0 || proof.data.length > 32_000_000) throw new Error('VOW_EMPTY_OR_OVERSIZED_PROOF');
  if (!call || typeof call !== 'object' || !('contract_address' in call) || !('entry_point' in call) || !('calldata' in call)
    || typeof call.contract_address !== 'string' || typeof call.entry_point !== 'string') throw new Error('VOW_INVALID_PROOF');
  return { call: { contract_address: call.contract_address, entry_point: call.entry_point, calldata: felts(call.calldata, 4096) },
    proof: { data: proof.data, output: felts(proof.output, 65536), proof_facts: felts(proof.proof_facts, 1024) } };
}

function felts(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('VOW_INVALID_PROOF');
  return value.map((entry: unknown) => {
    if (typeof entry !== 'string' || entry.length > 80 || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(entry)) throw new Error('VOW_INVALID_PROOF');
    felt(BigInt(entry), 'PROOF'); return entry;
  });
}
