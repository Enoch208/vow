# VOW reviewer guide

VOW explores confidential delegated procurement on STRK20: an owner funds a constrained purchase, an operator cannot redirect it, and the supplier authorizes the exact STRK20 note used for collection.

The submitted repository currently contains a narrower `CollectionProbe` compatibility experiment. It has local contract and client tests, public mainnet pool observations, an independently checkable receipt verifier, and local wallet/deployment/collection review pages. The owner account activation and privacy registration are supported by accepted mainnet receipts. No VOW contract deployment, qualifying VOW pool transaction, supplier note credit, public demo, or complete VowVault workflow is claimed yet.

## Five-minute review

1. Read the implemented-scope and public/private tables in [README.md](README.md).
2. Inspect the fixed collection authority in [contracts/src/collection_probe.cairo](contracts/src/collection_probe.cairo) and its rollback, replay, deadline, donation, and recovery tests under [contracts/tests](contracts/tests).
3. Inspect the exact-note claim encoding in [packages/vow-sdk/src/claims.ts](packages/vow-sdk/src/claims.ts) and strict prepared-call checks in [packages/vow-sdk/src/prepared-claim.ts](packages/vow-sdk/src/prepared-claim.ts).
4. Run `npm run check` and `sh scripts/cairo.sh test`; setup and interpretation are in [REPRODUCE.md](REPRODUCE.md).
5. Review [evidence/claims.json](evidence/claims.json). Every entry states its evidence tier and limitations. The highest VOW collection claim remains local because no qualifying transaction exists.

## Local interfaces

Run `npm run diagnostic`, then open these loopback-only routes:

- `/deployment` validates public immutable terms. Its guarded local-model execution path reviews the next declaration, deployment, or funding stage against current public state, then can request that exact stage from Ready only after a separate approval. It journals public recovery data and requires receipt reconciliation before another stage.
- `/collection` is designed to check public contract state, prepare and review an exact destination-bound collection, and verify a supplied receipt. Its wallet submission control remains blocked while the total-budget gate is unverified.
- `/` reports wallet API version advertisement only.

Run `npm run supplier` separately for the supplier-key lifecycle. Its server is isolated from wallet discovery and external network access. Do not enter real secret material while reviewing source or tests.

## What the evidence establishes

- The local Cairo probe enforces one fixed owner-funded reservation, supplier-key authorization, an exact claim deadline, pool-only collection, atomic rollback, and owner recovery after expiry in a synthetic token/pool harness.
- TypeScript and Cairo agree on the fixed claim digest and signature vector.
- The deployed mainnet pool address, ABI, class, status, fee collector, and selected token were observed through one public RPC provider at pinned blocks.
- Accepted receipts verify activation of the selected owner account and registration of its public privacy key. Those setup transactions are not listed as qualifying VOW transactions.

## Open release gates

The repository still needs a deployed final contract whose class matches the released source, functional wallet preparation and dispatch, a confirmed supplier note, three qualifying mainnet transactions through VOW and the STRK20 pool, a public logged-out demo, and a three-minute video. [strk20.json](strk20.json) intentionally keeps transaction and contract arrays empty until genuine evidence exists.
