# VOW

Verifiable Operator Warrants for confidential delegated procurement on STRK20.

Status: local protocol implementation with a verified activated and privacy-registered owner account. No VOW deployment, mainnet supplier payment, wallet compatibility pass, or audit is claimed. The vault contract exists and is tested locally; it has never been declared, deployed or funded on any network. Local owner, operator, supplier-claim and logged-out verifier routes are built, but no deployment manifest exists, so every write control on them is disabled and no reservation, creation or payment has been attempted.

The product lets an owner commit one-use purchase permissions, an operator reserve an approved purchase, and the supplier collect into its exact signed STRK20 note. Unused permissions remain unpublished: the chain stores a commitment root, not the supplier list.

## Implemented scope

- `VowVault`: isolated mandates, a 16-slot padded permission commitment tree, operator-signed reservations bounded by the committed cap and available budget, single-use permissions that expiry never re-arms, separate Funded/Reserved/Paid/Reclaimed accounting, revocation that preserves open supplier claims, owner recovery that excludes outstanding reservations, and pool-only destination-bound collection. No upgrade path, no generic external call, no admin sweep of accounted funds.
- `CollectionProbe`: one owner-funded reservation, one fixed supplier claim key, one pinned token/pool, exact received funding, destination-bound claim, and owner recovery after expiry. IDs are fixed to one; this is not VowVault.
- TypeScript claim encoding/signatures, integer amount utilities, a read-only wallet API version probe, and a strict prepared-call decoder pinned to the observed pool class.
- Cairo tests for funding, authorization, rollback, deadlines, recovery, donations, and replay; cross-language claim vectors; selected mutation checks.
- A collection preparation controller and local review page, with pinned-block contract checks, exact-note signature verification, invalidation, bounded waits, and final preparation review. No transaction submission.
- A separate local supplier-key page with encrypted backup, required restore before sharing the key, exact-claim review/signing, and session locking.
- Integer-only test-budget assessment that requires principal, every fee category, and a fresh STRK/USD quote before reporting whether a proposed total fits its cap.
- Read-only collection receipt verification, an exact call/proof submission review, and a durable attempt journal with Web Locks coordination. The collection page can request the exact reviewed wallet call only when a matching, fresh local budget manifest is present; no approved manifest is shipped.
- A local `/claim/:reservationId` VowVault path that reads the reservation and pinned classes before enabling wallet preparation or supplier signature input, plus `/verify/:txHash`, which needs no wallet and requires the exact `ReservationClaimed` event, matching pool deposit, claimed reservation state and token-pull trace. Its preloaded real successful mainnet transaction is an unrelated negative control and is rejected as VOW evidence.
- A block-pinned public mainnet pool observation and its ABI. These reads are not VOW transaction evidence.

See [reproduction instructions](REPRODUCE.md), [compatibility](COMPATIBILITY.md), [threat model](THREAT_MODEL.md), and [claim evidence](evidence/claims.json).

## Public and private

| Information | Visibility |
|---|---|
| Experiment owner, funding amount, token, supplier claim key, deadline | Public if deployed |
| Collection note ID, amount, timing, and helper address | Public |
| Supplier signing key | Local; never requested in a URL or RPC call |
| Note ownership privacy | Depends on the actual STRK20 wallet/pool flow; not yet demonstrated by VOW |
| Unused procurement permissions | Not published by the protocol; only the commitment root is on chain |
| Exercised permission, its amount, supplier pseudonym and timing | Public once reserved |

Neither contract has a generic call, upgrade, donation sweep, or public supplier payout function. Because there is no sweep, tokens transferred to the vault outside `fund_mandate` are never counted as budget and are also never recoverable. Pool correctness, token behavior, wallet readiness, screening, and real note ownership remain integration dependencies. Do not fund the experiment before its compatibility and transaction preview are reviewed.

Ready advertises Wallet API 0.10.3, but live collection is still unverified. The probe review page is at `/collection` when running `npm run diagnostic`. Its authorized browser check verified desktop initial-state and invalid-input assertions; mobile checks did not complete; see [milestone evidence](evidence/collection-workbench-checks.json).

Run `npm run app` for the VowVault product routes at `http://127.0.0.1:4319`. `/` states the problem and links the screens, the shipped documents and the verifier. `/owner` builds a permission set locally, shows a preview of exactly what creation publishes and what it withholds before anything is created, downloads the encrypted backup, and unlocks that downloaded file again to prove it restores the previewed root before the creation call is enabled; it always reports Funded, Available, Reserved, Paid and Reclaimed as five separate values. `/operator` unlocks the committed set, checks it against the mandate root already on chain, and reserves one selected permission object; it has no field for a supplier key, token or deadline, and an edited permission object stops matching the committed root. `/verify` preloads the public T-017 negative-control transaction and verifies it without a wallet; `/claim/:reservationId` stays read-only until a real deployment manifest replaces the explicitly undeployed build manifest.

Every write on those routes moves through one explicit state: READY, SIGNING, SUBMITTED, then CONFIRMED, REJECTED, REVERTED or UNKNOWN. A wallet timeout is UNKNOWN, never a retry; a late transaction hash is recorded against the same unresolved attempt so it can be reconciled against its public receipt. Because no manifest is shipped, the owner and operator routes load fail-closed and neither has sent a transaction. See [claim and verifier evidence](evidence/vault-claim-verifier-checks.json) and [product screen evidence](evidence/product-screen-checks.json).

Run `npm run supplier` to open the separate supplier tool at `http://127.0.0.1:4318/`. Its empty-state browser check passed. Backup restoration, signing and collection preparation are connected in a synthetic local integration test; the browser test generated no key and entered no secret. See [supplier milestone evidence](evidence/supplier-tool-checks.json).

Deployment-preview tooling builds deterministic UDC calldata and an exact principal-funding batch without signing or network access. It does not estimate fees or authorize spending. See [preview evidence](evidence/deployment-preview-checks.json).

Deployment preflight now reads public account, declaration, UDC, token and pool state at one block, preserving explicit absence separately from RPC failure. The local `/activation` page reads wallet deployment metadata on demand and verifies its derived account address before displaying the public result. Neither tool activates an account or estimates a fee. See [deployment-readiness evidence](evidence/deployment-readiness-checks.json).

The owner account activation and privacy registration are now verified from accepted mainnet receipts. Owner outflow was 0.055724097349665504 STRK for activation plus 6.1 STRK transferred during **Enable private tokens**, for 6.155724097349665504 STRK total owner outflow. The registration receipt's 2.885883499721302016 STRK network fee was paid by a separate relayer and is not added to the owner total. The 6.1 STRK is an asset transfer into the setup flow, not asserted to be entirely fees; the pool's raw fee value would equal 6 STRK if it is STRK-denominated with 18 decimals, but its denomination and whether it is already represented in that transfer remain unverified.

A fresh unsigned estimate at mainnet block 14515326 omitted the completed activation and estimated declaration, deployment, and funding network fees at 11.52476084897244256 STRK with signature validation skipped. Adding the proposed 0.1 STRK VOW principal produces a partial projected owner outflow of 17.780484946322108064 STRK, including the 6.155724097349665504 STRK already spent. This is not a complete budget: collection gas, wallet/prover charges, the collection protocol-fee path, recovery reserve, and final wallet fee limits are unknown. No VOW spending has been authorized. See [registration evidence](evidence/registration-receipt-observation.json), [activation evidence](evidence/owner-activation-receipt.json), and [remaining fee estimate](evidence/registered-deployment-fee-observation.json).

The local `/deployment` page derives the predicted address and exact calls from public terms, checks the next declaration, deployment, or funding stage against current chain state, and asks Ready for only that reviewed stage after an explicit stage approval. It persists public recovery records before dispatch and requires exact transaction, receipt, fee, and post-state reconciliation before advancing. The collection UI has the same fail-closed dispatch and recovery path, with an additional exact budget-manifest gate. Neither browser path has completed a real VOW transaction.
