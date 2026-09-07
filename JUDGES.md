# VOW reviewer guide

VOW explores confidential delegated procurement on STRK20: an owner funds a constrained purchase, an operator cannot redirect it, and the supplier authorizes the exact STRK20 note used for collection.

The repository contains a locally tested `VowVault` protocol layer and a narrower `CollectionProbe` compatibility experiment. It also contains public mainnet pool observations, an independently checkable receipt verifier, and local owner, operator, supplier, deployment, and collection review pages. The owner account activation and privacy registration are supported by accepted mainnet receipts. No VOW contract deployment, qualifying VOW pool transaction, supplier note credit, or public demo is claimed.

## Five-minute path

1. Read the status paragraph and public/private table in [README.md](README.md), then open [strk20.json](strk20.json). Its empty transaction and contract arrays are the release truth: there is no VOW deployment or qualifying collection to inspect.
2. Run `git log --reverse --format='%h %s'`. The history starts with exact-note claim and probe invariants, then supplier/collection tooling, then VowVault, then evidence and T-020.
3. Inspect [contracts/src/vault.cairo](contracts/src/vault.cairo) beside [contracts/tests/test_vault_guards.cairo](contracts/tests/test_vault_guards.cairo). Search for `VOW_BAD_POOL`, `VOW_PERMISSION_USED`, `VOW_INSUFFICIENT_AVAILABLE`, and `VOW_STALE_ALLOWANCE` to see the pool, single-use, accounting, and stale-approval boundaries with their adversarial tests.
4. Inspect [packages/vow-sdk/src/claims.ts](packages/vow-sdk/src/claims.ts) and [packages/vow-sdk/src/prepared-claim.ts](packages/vow-sdk/src/prepared-claim.ts). The supplier signs the exact note and the decoder rejects a changed helper, note, token, amount, pool class, or extra public transfer.
5. Run `npm run evidence:verify`, then `npm run ci:clean` for the full release gate. The recorded cache-assisted run completed in 43.44 seconds with 38 Cairo tests and 267 SDK tests passing; its exact environment, counts, and limitations are in [evidence/clean-clone-checks.json](evidence/clean-clone-checks.json).

End at [evidence/claims.json](evidence/claims.json). Each claim names its tier, files, reproduction command where applicable, and limitations. `G0` remains proposed because the local gate cannot substitute for a qualifying mainnet collection.

## Local interfaces

Run `npm run diagnostic`, then open these loopback-only routes:

- `/deployment` validates public immutable terms. Its guarded local-model execution path reviews the next declaration, deployment, or funding stage against current public state, then can request that exact stage from Ready only after a separate approval. It journals public recovery data and requires receipt reconciliation before another stage.
- `/collection` is designed to check public contract state, prepare and review an exact destination-bound collection, and verify a supplied receipt. Its wallet submission control remains blocked while the total-budget gate is unverified.
- `/` reports wallet API version advertisement only.

Run `npm run supplier` separately for the supplier-key lifecycle. Its server is isolated from wallet discovery and external network access. Do not enter real secret material while reviewing source or tests.

## What the evidence establishes

- The local Cairo probe enforces one fixed owner-funded reservation, supplier-key authorization, an exact claim deadline, pool-only collection, atomic rollback, and owner recovery after expiry in a synthetic token/pool harness.
- The local VowVault tests enforce committed permission membership, operator-bound reservations, single-use permissions, isolated mandate accounting, revocation, recovery that excludes reservations, and pool-only destination-bound collection.
- TypeScript and Cairo agree on the fixed claim digest and signature vector.
- T-020 rebuilds from committed source in a clean clone, runs both test suites, and verifies the public evidence ledger.
- The deployed mainnet pool address, ABI, class, status, fee collector, and selected token were observed through one public RPC provider at pinned blocks.
- Accepted receipts verify activation of the selected owner account and registration of its public privacy key. Those setup transactions are not listed as qualifying VOW transactions.

## Open release gates

The repository still needs a deployed final contract whose class matches the released source, functional wallet preparation and dispatch, a confirmed supplier note, three qualifying mainnet transactions through VOW and the STRK20 pool, a public logged-out demo, and a three-minute video. [strk20.json](strk20.json) intentionally keeps transaction and contract arrays empty until genuine evidence exists.
