# VOW reviewer guide

VOW explores confidential delegated procurement on STRK20: an owner funds a constrained purchase, an operator cannot redirect it, and the supplier authorizes the exact STRK20 note used for collection.

The matching `VowVault` class is declared and deployed on Starknet mainnet. A controlled 0.1 STRK mandate was created, atomically funded and fully reserved on that deployment. The reservation is open with Paid and Reclaimed both zero. No qualifying VOW pool collection, supplier note credit, compatibility pass, public deployment of the UI or audit is claimed.

| Live deployment | Starknet mainnet value |
|---|---|
| VowVault | `0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227` |
| Class hash | `0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14` |
| STRK20 pool | `0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Deployment account | `0x3f3cc7727c66634967621dc8d4697f1bfd6c29f81757496a4783bf5c90deb89` |

Release status: **0 of 5 gates pass.** Deployment and an open reservation do not satisfy G0; one genuinely successful destination-bound supplier collection through the live pool is still required. G1 cannot be declared complete while G0 is unresolved, and G2–G4 remain open.

## Five-minute path

1. **0:00–0:30 — Problem.** Read the status and first paragraph in [README.md](README.md): an operator needs bounded buying authority, not the treasury key, while publishing every unused permission would disclose the procurement plan.
2. **0:30–1:15 — Committed permissions.** Inspect [packages/vow-sdk/src/permission-set.ts](packages/vow-sdk/src/permission-set.ts) and the public/private table in README. The chain receives a padded 16-slot root; the selected leaf becomes public on reservation, while the other leaves are not published by VOW.
3. **1:15–2:15 — Mainnet evidence.** Open [strk20.json](strk20.json) and [evidence/vault-deployment-observation.json](evidence/vault-deployment-observation.json). Verify the four identifiers above, then inspect mandate 1: Funded 0.1 STRK, Available 0, Reserved 0.1 STRK, Paid 0, Reclaimed 0. Its open reservation is mainnet execution evidence, not a payment or qualifying pool collection; the three listed setup transactions are explicitly labeled non-qualifying.
4. **2:15–3:00 — Enforcement negatives.** Run `sh scripts/cairo.sh test` and use the matrix below for recipient substitution, overspend, replay and pool-only settlement. These are local executions of the Cairo vault logic with synthetic token and pool contracts, not mined reverts.
5. **3:00–4:00 — Integration.** Inspect [packages/vow-sdk/src/prepared-claim.ts](packages/vow-sdk/src/prepared-claim.ts), then run `npm run app` and open `/verify`. The logged-out verifier requires the exact VowVault event, pool deposit, claimed reservation and token-pull trace. The preloaded successful unrelated transaction must be rejected. Ready returned a real prepared action list whose sanitized optional-screening shape now passes the local regression. A fresh live preparation, supplier signature and collection still have not occurred.
6. **4:00–5:00 — Open source.** Read [PRIVACY.md](PRIVACY.md), [THREAT_MODEL.md](THREAT_MODEL.md), [REPRODUCE.md](REPRODUCE.md), and [evidence/claims.json](evidence/claims.json). Run `npm run check`, `sh scripts/cairo.sh test`, and `npm run evidence:verify`. The recorded clean-clone evidence predates this deployment and must be refreshed against the frozen release; use the command output rather than a stale test count.

## §24.1 contract enforcement

`sh scripts/cairo.sh test` executes the Cairo vault logic with synthetic token and pool contracts. The command is reproducible but does not turn these local negatives into mainnet execution evidence.

| Invariant | What it forbids | Proving test |
|---|---|---|
| T-005 exact signature scope | Reusing an operator signature for a changed amount, request, commitment root or mandate | `t_005_the_operator_signature_cannot_be_moved_to_another_request` in `contracts/tests/test_vault_guards.cairo` |
| T-002 proof and recipient binding | Raising the cap, borrowing a proof, or substituting the owner-approved supplier | `t_002_an_altered_permission_or_proof_cannot_reserve` and `t_002_a_permission_bound_to_another_supplier_cannot_borrow_a_proof` in `contracts/tests/test_vault_guards.cairo` |
| T-003 no overspend | Reserving more than the funded amount still available | `t_003_a_third_individually_valid_approval_cannot_overdraw` in `contracts/tests/test_vault.cairo` |
| T-004 single use | Replaying a consumed permission before or after expiry | `t_004_a_consumed_permission_cannot_reserve_again_after_expiry` in `contracts/tests/test_vault.cairo` |
| T-011 pool-only collection | Direct or outsider calls settling a reservation | `t_011_only_the_configured_pool_can_settle_a_reservation` in `contracts/tests/test_vault_guards.cairo` |

Run `npm run verify:vault` to read the mainnet class and pool and compare the deployed ABI with the exact allowlist. A passing result establishes that this deployed ABI exposes no generic drain, arbitrary external-call, root-replacement or upgrade entrypoint. It does not audit the implementation behind the allowed entrypoints and remains a single-provider observation.

## Local interfaces

Run `npm run diagnostic`, then open these loopback-only routes:

- `/deployment` validates public immutable terms. Its guarded local-model execution path reviews the next declaration, deployment, or funding stage against current public state, then can request that exact stage from Ready only after a separate approval. It journals public recovery data and requires receipt reconciliation before another stage.
- `/collection` is designed to check public contract state, prepare and review an exact destination-bound collection, and verify a supplied receipt. Its wallet submission control remains blocked while the total-budget gate is unverified.
- `/` reports wallet API version advertisement only.

Run `npm run supplier` separately for the supplier-key lifecycle. Its server is isolated from wallet discovery and external network access. Do not enter real secret material while reviewing source or tests.

Run `npm run app`, then open `/verify`. It preloads the real successful T-017 negative-control transaction and uses no wallet. It must reject that unrelated transaction as `VOW_COLLECTION_EVENTS_MISSING`. Missing or timed-out receipt, block, class, state or trace reads render as UNKNOWN, never as a pass or a fail.

## What the evidence establishes

- The local Cairo probe enforces one fixed owner-funded reservation, supplier-key authorization, an exact claim deadline, pool-only collection, atomic rollback, and owner recovery after expiry in a synthetic token/pool harness.
- The local VowVault tests enforce committed permission membership, operator-bound reservations, single-use permissions, isolated mandate accounting, revocation, recovery that excludes reservations, and pool-only destination-bound collection.
- The deployed VowVault address has the pinned class hash and pool in a single-provider read. Its ABI has exactly the allowlisted entrypoints and no generic drain, arbitrary external-call, root-replacement or upgrade entrypoint.
- TypeScript and Cairo agree on the fixed claim digest and signature vector.
- T-020 rebuilds from committed source in a clean clone, runs both test suites, and verifies the public evidence ledger.
- The deployed mainnet pool address, ABI, class, status, fee collector, and selected token were observed through one public RPC provider at pinned blocks.
- Accepted receipts verify activation and privacy-key registration for the separate Ready setup account `0x5282ba58af3296b7c6bdb51dfb12789cbf4603799e7fc8baef6a9704de1679e`. It is not the deployment account, and those setup transactions are not qualifying VOW transactions.
- Accepted mainnet receipts verify the final class declaration, VowVault deployment, mandate creation, atomic 0.1 STRK funding and one bounded reservation. The open reservation is not a payment.
- `/claim/0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2b` reads that reservation from chain before enabling wallet work. Ready X 5.33.9 advertises API 0.10.3 and returned a real prepared action list. VOW rejected the first response because its decoder required a screening suffix that Ready omitted; the sanitized response shape now passes locally. No supplier signature or collection transaction followed.

## Open release gates

Zero of five gates pass. G0 still needs one destination-bound collection through the live pool. G1 has local invariant coverage but cannot be declared complete while G0 is unresolved. G2 then needs three qualifying collections on the final deployment, and G3/G4 still need refreshed clean-clone evidence, logged-out public hosting, independent attempts, a three-minute video and final submission links. [strk20.json](strk20.json) currently lists three explicitly non-qualifying setup transactions; no supplier collection is claimed.
