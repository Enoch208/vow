import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = resolve(root, 'evidence');
const tiers = new Set([
  'proposed',
  'local-model',
  'local-contract-test',
  'deployed',
  'mainnet-executed',
  'independently-reproduced',
]);
const sha256 = /^[0-9a-f]{64}$/;
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n'));

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safePath(value, label) {
  requireCondition(typeof value === 'string' && value.length > 0, `VOW_EVIDENCE_${label}_PATH`);
  requireCondition(!value.startsWith('/') && !value.includes('..') && !value.includes('\\'), `VOW_EVIDENCE_${label}_PATH`);
  const absolute = resolve(root, value);
  requireCondition(absolute.startsWith(root + sep), `VOW_EVIDENCE_${label}_PATH`);
  return absolute;
}

async function json(relative) {
  return JSON.parse(await readFile(safePath(relative, 'JSON'), 'utf8'));
}

const evidenceFiles = (await readdir(evidenceRoot))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => `evidence/${name}`);
const parsedEvidence = new Map();
for (const file of evidenceFiles) parsedEvidence.set(file, await json(file));

const ledger = parsedEvidence.get('evidence/claims.json');
requireCondition(record(ledger) && ledger.schemaVersion === 1 && Array.isArray(ledger.claims), 'VOW_EVIDENCE_LEDGER_SCHEMA');
const claimIds = new Set();
let evidenceReferences = 0;
for (const claim of ledger.claims) {
  requireCondition(record(claim), 'VOW_EVIDENCE_CLAIM_SCHEMA');
  requireCondition(typeof claim.id === 'string' && /^[A-Z0-9-]+$/.test(claim.id) && !claimIds.has(claim.id), 'VOW_EVIDENCE_CLAIM_ID');
  claimIds.add(claim.id);
  requireCondition(typeof claim.claim === 'string' && claim.claim.length > 0, `VOW_EVIDENCE_${claim.id}_TEXT`);
  requireCondition(tiers.has(claim.tier), `VOW_EVIDENCE_${claim.id}_TIER`);
  requireCondition(claim.sourceCommit === null || (typeof claim.sourceCommit === 'string' && /^[0-9a-f]{40}$/.test(claim.sourceCommit)), `VOW_EVIDENCE_${claim.id}_COMMIT`);
  requireCondition(Array.isArray(claim.evidence), `VOW_EVIDENCE_${claim.id}_REFERENCES`);
  requireCondition(claim.tier === 'proposed' || claim.evidence.length > 0, `VOW_EVIDENCE_${claim.id}_REFERENCES`);
  requireCondition(new Set(claim.evidence).size === claim.evidence.length, `VOW_EVIDENCE_${claim.id}_DUPLICATE_REFERENCE`);
  for (const reference of claim.evidence) {
    const absolute = safePath(reference, claim.id);
    requireCondition(tracked.has(reference), `VOW_EVIDENCE_${claim.id}_UNTRACKED_REFERENCE`);
    requireCondition((await stat(absolute)).isFile(), `VOW_EVIDENCE_${claim.id}_MISSING_REFERENCE`);
    evidenceReferences += 1;
  }
  requireCondition(Array.isArray(claim.limitations) && claim.limitations.length > 0, `VOW_EVIDENCE_${claim.id}_LIMITATIONS`);
  requireCondition(claim.limitations.every((value) => typeof value === 'string' && value.length > 0), `VOW_EVIDENCE_${claim.id}_LIMITATIONS`);
}

let hashedSources = 0;
for (const [file, value] of parsedEvidence) {
  if (!record(value)) continue;
  for (const field of ['sha256', 'sourceSha256']) {
    const hashes = value[field];
    if (hashes === undefined) continue;
    requireCondition(record(hashes), `VOW_EVIDENCE_${file}_${field}`);
    for (const [source, digest] of Object.entries(hashes)) {
      requireCondition(sha256.test(digest), `VOW_EVIDENCE_${file}_${field}_DIGEST`);
      requireCondition((await stat(safePath(source, field))).isFile(), `VOW_EVIDENCE_${file}_${field}_SOURCE`);
      hashedSources += 1;
    }
  }
}

const poolAbi = parsedEvidence.get('evidence/pool-abi.json');
const poolObservation = parsedEvidence.get('evidence/pool-observation.json');
requireCondition(Array.isArray(poolAbi) && record(poolObservation), 'VOW_EVIDENCE_POOL_SCHEMA');
const poolAbiDigest = createHash('sha256').update(JSON.stringify(poolAbi)).digest('hex');
requireCondition(poolAbiDigest === poolObservation.abiSha256, 'VOW_EVIDENCE_POOL_ABI_DIGEST');

const submission = await json('strk20.json');
requireCondition(record(submission) && Array.isArray(submission.transactions) && Array.isArray(submission.contracts), 'VOW_EVIDENCE_SUBMISSION_SCHEMA');

process.stdout.write(`Evidence verified: ${ledger.claims.length} claims, ${evidenceFiles.length} JSON files, ${evidenceReferences} claim references, ${hashedSources} recorded source hashes.\n`);
