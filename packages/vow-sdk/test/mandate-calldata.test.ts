import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertMandateMatchesSet, buildCreateMandateCall, buildFundMandateCalls,
} from '../src/mandate-calldata.ts';
import type { MandateTerms } from '../src/mandate-calldata.ts';
import { isStarkPublicKey } from '../src/operator-key.ts';
import { PermissionSet } from '../src/permission-set.ts';
import { U128_MAX } from '../src/integers.ts';
import type { VaultMandate } from '../src/reservation-reader.ts';
import {
  CHAIN, EXPIRES_AT, FIXTURE_ROOT, MANDATE, NOW, OPERATOR_KEY, OWNER, REQUESTS, TOKEN, VAULT,
  fixturePaddingSalts, fixturePermissions, fixtureSet,
} from './helpers/vault-client.ts';

const terms: MandateTerms = {
  chainId: CHAIN, owner: OWNER, operatorKey: OPERATOR_KEY, expiresAt: EXPIRES_AT,
};
const mandate: VaultMandate = {
  mandateId: MANDATE, owner: OWNER, root: FIXTURE_ROOT, operatorKey: OPERATOR_KEY, token: TOKEN,
  expiresAt: EXPIRES_AT, revoked: false, funded: 100n, reserved: 40n, paid: 0n, reclaimed: 0n,
};

test('T-019 mandate creation commits the padded root, token and operator key of the set', () => {
  const creation = buildCreateMandateCall(fixtureSet(), terms, NOW);
  assert.deepEqual(creation.call, {
    contractAddress: `0x${VAULT.toString(16)}`,
    entrypoint: 'create_mandate',
    calldata: [OWNER, FIXTURE_ROOT, OPERATOR_KEY, TOKEN, EXPIRES_AT].map((value) => `0x${value.toString(16)}`),
  });
  assert.equal(creation.expectedMandateId, MANDATE);
  assert.equal(creation.root, FIXTURE_ROOT);
  assert.equal(creation.token, TOKEN);
  assert.equal(Object.isFrozen(creation.call), true);
});

test('T-019 funding approves the exact base-unit amount to the vault that the permissions bind', () => {
  const calls = buildFundMandateCalls(fixtureSet(), 100n);
  assert.deepEqual([...calls], [
    { contractAddress: `0x${TOKEN.toString(16)}`, entrypoint: 'approve', calldata: [`0x${VAULT.toString(16)}`, '0x64', '0x0'] },
    { contractAddress: `0x${VAULT.toString(16)}`, entrypoint: 'fund_mandate', calldata: ['0x1', '0x64'] },
  ]);
  for (const amount of [0n, -1n, U128_MAX + 1n]) {
    assert.throws(() => buildFundMandateCalls(fixtureSet(), amount), /AMOUNT/);
  }
});

test('T-019 unusable mandate terms are refused before any wallet call', () => {
  const set = fixtureSet();
  assert.equal(isStarkPublicKey(5n), false);
  assert.throws(() => buildCreateMandateCall(set, { ...terms, chainId: CHAIN + 1n }, NOW), /WRONG_CHAIN/);
  assert.throws(() => buildCreateMandateCall(set, { ...terms, owner: 0n }, NOW), /OWNER/);
  assert.throws(() => buildCreateMandateCall(set, { ...terms, operatorKey: 5n }, NOW), /INVALID_OPERATOR_KEY/);
  assert.throws(() => buildCreateMandateCall(set, { ...terms, expiresAt: NOW }, NOW), /MANDATE_CLOSED/);
  const late = PermissionSet.assemble({
    permissions: fixturePermissions().map((leaf) => ({ ...leaf, claimBefore: EXPIRES_AT + 1n })),
    paddingSalts: fixturePaddingSalts(),
  });
  assert.throws(() => buildCreateMandateCall(late, terms, NOW), /CLAIM_AFTER_MANDATE_EXPIRY/);
});

test('T-019 a created mandate is checked against the local set before it is funded', () => {
  const set = fixtureSet();
  assertMandateMatchesSet(mandate, set, terms);
  const changes: Partial<VaultMandate>[] = [
    { root: FIXTURE_ROOT + 1n }, { token: TOKEN + 1n }, { owner: OWNER + 1n },
    { operatorKey: OPERATOR_KEY + 1n }, { expiresAt: EXPIRES_AT + 1n }, { mandateId: MANDATE + 1n },
  ];
  for (const change of changes) {
    assert.throws(() => assertMandateMatchesSet({ ...mandate, ...change }, set, terms), /MANDATE_MISMATCH/, JSON.stringify(Object.keys(change)));
  }
  assert.throws(() => assertMandateMatchesSet({ ...mandate, revoked: true }, set, terms), /MANDATE_CLOSED/);
  const other = PermissionSet.create(REQUESTS);
  assert.throws(() => assertMandateMatchesSet(mandate, other, terms), /MANDATE_MISMATCH/);
});
