import json
import os
import pathlib
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
source = pathlib.Path('src/collection_probe.cairo')
mutations = {
    'pool-only': 'get_caller_address() == self.pool.read()',
    'supplier-signature': 'check_ecdsa_signature(digest, self.supplier_key.read(), signature_r, signature_s)',
    'exact-funding': 'token.balance_of(here) == before + amount.into()',
    'signature-expiry': 'now < signature_deadline',
    'deadline-extension': 'signature_deadline <= self.claim_before.read()',
    'stale-allowance': 'token.allowance(get_contract_address(), self.pool.read()) == 0',
    'claim-operation': "operation == 'CLAIM'",
    'reservation-id': 'reservation_id == 1',
    'owner-recovery-time': 'get_block_timestamp() >= self.claim_before.read()',
    'owner-authority': 'get_caller_address() == self.owner.read()',
}
env = dict(os.environ)
bins = [
    root / '.tools/scarb/scarb-v2.17.0-aarch64-apple-darwin/bin',
    root / '.tools/foundry/starknet-foundry-v0.63.0-aarch64-apple-darwin/bin',
    root / '.tools/usc/universal-sierra-compiler-v2.10.0-aarch64-apple-darwin/bin',
]
env['PATH'] = os.pathsep.join(map(str, bins)) + os.pathsep + env['PATH']
env['SCARB_CACHE'] = str(root / '.cache/scarb')
results = []
for name, expression in mutations.items():
    with tempfile.TemporaryDirectory(prefix='vow-mutation-') as temporary:
        checkout = pathlib.Path(temporary) / 'contracts'
        shutil.copytree(root / 'contracts', checkout, ignore=shutil.ignore_patterns('target', '.snfoundry_cache'))
        path = checkout / source
        original = path.read_text()
        if expression not in original:
            raise SystemExit(f'Mutation expression missing: {name}')
        path.write_text(original.replace(expression, 'true'))
        run = subprocess.run(['scarb', 'test'], cwd=checkout, env=env, capture_output=True, text=True, timeout=120)
        output = run.stdout + run.stderr
        detected = run.returncode != 0 and '[FAIL]' in output and 'Tests:' in output
        results.append({'guard': name, 'detectedByTestFailure': detected})
        print(name, 'detected' if detected else 'NOT DETECTED', flush=True)
        if not detected:
            print(output[-3000:])
report = {'scope': 'Selected CollectionProbe guards only; not exhaustive mutation coverage.', 'mutations': results}
(root / 'evidence/collection-mutations.json').write_text(json.dumps(report, indent=2) + '\n')
if not all(result['detectedByTestFailure'] for result in results):
    raise SystemExit(1)
