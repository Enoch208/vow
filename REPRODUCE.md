# Reproduce the collection experiment

Use Node 24.14 or later in the Node 24 series, npm, Python 3.12 or later, and curl. The supplied Cairo bootstrap is for macOS Apple Silicon. Other platforms need the same official Scarb 2.17.0, snforge 0.63.0, and universal-sierra-compiler 2.10.0 versions on PATH.

```sh
npm ci --ignore-scripts
python3 scripts/install-cairo.py
npm run build:workbench
npm run check
sh scripts/cairo.sh test
python3 scripts/mutate-collection.py
```

The bootstrap verifies pinned SHA-256 digests before extracting into the ignored `.tools` directory. It does not modify the global toolchain. The wrapper uses a project-local Scarb cache. Mutation checks run in temporary copies and never modify the working contract. A compiler failure does not count as a detected mutation.

`npm run check` checks types, emits JavaScript under ignored `dist`, and runs the TypeScript tests. Cairo tests deploy a synthetic token and pool locally; they do not submit transactions. The shared claim digest/signature vector checks agreement across TypeScript and Cairo, not the unimplemented permission hash.

To refresh the public, read-only pool observation:

```sh
node scripts/inspect-pool.ts
```

This command pins reads to one returned block hash and writes `evidence/pool-observation.json` and `evidence/pool-abi.json`. It has no signing key and submits no transaction. A class/ABI change requires review and decoder updates; the schema test should then fail until reconciled. One provider's response does not establish independently reproduced evidence.

Run the local read-only wallet diagnostic with:

```sh
npm run diagnostic
```

Open `http://127.0.0.1:4317` in the browser where Ready is installed. Select the detected wallet and press **Run read-only check**. The page discovers providers through the Wallet Standard registry or Ready's documented `starknet_argentX` injection. Discovery reads identity/version metadata only. The button sends `wallet_supportedWalletApi` without parameters; it never calls connect, requests accounts, or asks for a signature. A locked or unconnected wallet can refuse the request; that remains unverified. Share the sanitized text result, never private wallet material. Press Ctrl+C in the server terminal to stop it.

The diagnostic binds only to loopback, accepts GET/HEAD requests, serves a fixed file allowlist, rejects unexpected Host headers, and has no result-upload endpoint or telemetry. HTTP tests need permission to bind loopback sockets; restricted execution environments may need to allow that explicitly.

The user supplied a successful Ready X 5.33.9 version-query result advertising 0.10.3 and 0.7.2. This does not establish collection support. A browser check passed the initial and rescan states, confirming the notices and unchanged “No capability check has run” result. No wallet request was sent during that check. The prepared-call decoder has synthetic tests against the recorded live ABI, not a captured Ready preparation. Neither function establishes proving or transaction submission support. Results and source fingerprints for this slice are in `evidence/diagnostic-checks.json`.

A source-only temporary-directory reproduction passed fresh offline `npm ci`, TypeScript checks/tests, Cairo compilation, and Cairo tests using the pinned installed toolchain and download caches. This is not a fresh-machine installation or a published clean-clone release. The observed outcomes and source fingerprints are in `evidence/local-checks.json` and `evidence/claims.json`.

## Collection review workbench

`npm run diagnostic` also serves `http://127.0.0.1:4317/collection`. Its build compiles the Cairo probe, derives its Sierra class hash, and bundles dependencies locally with pinned esbuild. The diagnostic page retains its network-disabled policy; only the collection page can contact the fixed public Cartridge RPC endpoint. Tests of workbench HTTP assets require `npm run build:workbench` first.

The workbench starts without a deployment. It accepts a reviewed public JSON manifest with these fields, each an integer encoded as a decimal or hexadecimal string: `chainId`, `vaultAddress`, `probeClassHash`, `poolAddress`, `token`, `supplierKey`, `amount`, `claimBefore`, `recipient`, `signatureDeadline`, `feeToken`, `feeCollector`, `maximumFee`. Amounts and fee limits are base units; timestamps are Unix seconds. The mainnet chain and locally built probe class must match. The local class hash is shown on the page; this does not mean it is deployed. A manifest is expected public terms, not an independently authenticated deployment attestation.

After validating terms, the supplier explicitly requests preparation. The controller checks wallet version/network and reads contract configuration, state, public balance, allowance, pool pause state and fee collector at one pinned block. It compares the class hashes and terms, rejects stale blocks, and checks again after preparation. It requests a simulation with `api_version: 0.10.3`, extracts the exact note structurally, and presents the claim digest and configured supplier public key. The supplier signs with their separate local claim key using the supplier tool or `signClaim`; the collection page accepts only signature r/s, never the key. The collection page does not generate or recover claim keys.

A valid supplier signature enables a second preparation with proof generation. The controller rejects changed notes, changed invocation data, empty proof data, extra public transfers, changed state, and expired deadlines. Proof material stays in memory and is not displayed, saved or submitted. The SDK can release one copied prepared call after fresh preflight; the page provides no submission or payload export action. Proof structure is checked; proof validity and encrypted ownership are not independently verified. A timeout discards the result and prevents the same controller from overlapping the still-running request. Wallet identity/network events discard the UI preparation.

The automated suite uses synthetic wallet responses and synthetic proof strings. Real Ready preparation and settlement are not tested. The user authorized external browser validation after an initial approval-review block. Desktop initial-state, disabled-control and invalid-manifest assertions passed. The first run exhausted its step budget; a focused rerun stopped before mobile checks due to an incorrect preparation prerequisite. Mobile layout remains unverified. No wallet request or funded transaction was part of these browser objectives.

## VowVault claim and logged-out verification

Run `npm run app`, then open `http://127.0.0.1:4319/verify`. The route preloads transaction `0x39db0c00d44f27f2e22f02abad354fc93c32a8202b04e41291a990554d49d1e`, a real successful mainnet negative control. The verifier uses no wallet and must report `VOW_COLLECTION_EVENTS_MISSING`: transaction success without the pinned VowVault `ReservationClaimed` event is not VOW evidence.

The same command serves the product screens. Open `http://127.0.0.1:4319/` for the overview, `/owner` and `/operator` for the two write screens. Both read `dist/deployment/manifest.json`; no manifest is shipped, so both load fail-closed, report the missing deployment and keep every write control disabled. Their behaviour is covered by `packages/vow-sdk/test/app-screens.test.ts`, `owner-page.test.ts`, `operator-page.test.ts` and `write-flow.test.ts`, which run inside `npm run check`.

The supplier path is `/claim/:reservationId`. It accepts one decimal or hexadecimal public reservation ID and rejects query strings. Before discovering or requesting anything from a wallet, it reads the reservation, VowVault and pool classes, pool address, accounted balance, token balance, allowance, pool pause state and fee collector at one recent block. Only an open, funded, unexpired reservation matching the pinned deployment enables the STRK20 support check and note preparation. Signature r/s inputs remain disabled until the structurally decoded note is shown. The exact signed preparation is reviewed once, journaled before wallet dispatch and never described as confirmed until the public verifier confirms it.

The generated manifest in `dist/app/deployment.json` is explicitly `not-deployed`, carries a zero network-fee ceiling and leaves all claim controls disabled. Replacing it with a live manifest is a separate evidence-bearing deployment action, not part of the build. Positive claim and receipt tests are synthetic. See `evidence/vault-claim-verifier-checks.json`.

## Preview deployment and funding

Build the local contract with `npm run build:workbench`, then run `node scripts/preview-deployment.ts --help` for the exact public input fields. `node scripts/preview-deployment.ts public-terms.json` emits a JSON review package. It reads no wallet, uses no signing key, and makes no network request. Unknown fields are rejected without echoing their contents.

The class hash comes from the local compiled Cairo artifact. The preview uses Starknet.js 10.4.0's default owner-bound UDC deployment builder, includes the predicted contract address, and emits a separate atomic funding batch: approve exactly the base-unit principal, then call `fund`. It rejects principal above the configured cap and expired terms. The preview is not permission to execute: class declaration, UDC and pool code, token compatibility, fees, account state, and the total funding budget still require live checks. Network fees remain explicitly unestimated. Never submit approval and funding separately based solely on this file; first reconcile existing deployment/funding state and review the complete wallet transaction.

## Supplier backup and exact-claim signing

Run `npm run supplier` in a second terminal and open `http://127.0.0.1:4318/`. This origin has no network connections or wallet discovery. Generate an encrypted backup with a unique password of at least 16 characters, download it, then restore the saved file on the same page. Only successful restoration exposes the public key for sharing. Keep the backup and password private; losing either prevents recovery through this tool. Generating another key cannot change a supplier key already committed in a deployed probe.

After a real collection preparation, paste its public claim review into the supplier tool. Compare the displayed terms against the funded reservation, confirm, and sign. The tool recomputes the digest, checks the mainnet experiment context, bound supplier key and deadline, then returns public r/s for the collection page. It cannot authenticate chain state or establish note ownership. Signing locks the key; restore the backup to sign again. Manual lock, page exit and five minutes of inactivity clear the session.

Backups use native WebCrypto PBKDF2-HMAC-SHA256 with 600,000 iterations and a random 16-byte salt, then AES-256-GCM with a random 12-byte IV and 128-bit authentication tag. Format, iteration count and public key are authenticated. The iteration choice follows [OWASP PBKDF2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); the implementation uses [WebCrypto deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey). Password length is not an entropy guarantee. This implementation has not been audited.

`npm run check` includes encrypted round trips, wrong-password and tampering rejection, exact-note signatures, lock/deadline checks, strict review parsing, and a restored-key-to-prepared-collection integration test. Wallet and proof responses are synthetic. The approved browser check covers only the empty locked page and disabled controls; it generated no keys, opened no backup and entered no password.

## Total test-budget assessment

The exported `assessTestBudget` accepts a USD-cent cap, STRK principal and fee caps in base units, and a timestamped STRK/USD quote. Account activation, class declaration, probe deployment, funding, privacy registration, collection, protocol fees and a recovery reserve must each have an explicit estimate. A justified zero is distinct from a missing estimate. Missing values return `needs-estimates`; quotes older than five minutes or in the future are rejected. Costs are rounded up to whole USD cents using integer arithmetic. No current quote or live fee estimate is supplied by this utility, and its result neither authorizes a transaction nor guarantees a later exchange rate.

Creation feedback appears beside the Create button: passwords must match and contain 16–1024 characters. Invalid input remains available for correction and does not discard an existing downloadable backup. During encryption Download stays disabled; it enables only when encryption completes. The bundled-page regression tests execute the built JavaScript in a local Node VM with a minimal DOM harness and disposable inputs. They cover validation, successful creation, missing WebCrypto and locking during encryption, not a real browser download or the user's backup. See `evidence/supplier-create-checks.json`.

Password fields provide live length and confirmation feedback. Create remains disabled until the 16–1024 character check and exact match both pass. Each field has an accessible show/hide eye button; empty, cleared or busy fields return to masked display. These controls are covered by the bundled local regression harness, including length boundaries, edits that invalidate a match and masking on lock. See `evidence/supplier-password-controls-checks.json`.

## Deployment prerequisites and account metadata

After `npm run build:workbench`, run `node scripts/inspect-deployment.ts PUBLIC_OWNER_ADDRESS`. The CLI queries the fixed public Cartridge mainnet RPC and prints a block-pinned observation. It distinguishes RPC error 20 for an absent account from error 28 for an undeclared class; other failures do not become absence. It checks the pool class, STRK decimals, account balance and, if deployed, nonce. A returned probe class must hash to the local artifact. UDC/token class hashes are observations, not source verification. Raw pool fee data is not a confirmed fee estimate or token compatibility result.

The deployment address follows the pinned Starknet.js UDC constant and [OpenZeppelin deployment documentation](https://docs.openzeppelin.com/contracts-cairo/2.x/udc); STRK uses the [official mainnet address](https://docs.starknet.io/learn/cheatsheets/chain-info). Missing-class semantics follow the [Starknet node API specification](https://github.com/starkware-libs/starknet-specs/blob/master/api/starknet_api_openrpc.json).

Run `npm run diagnostic` and open `http://127.0.0.1:4317/activation` in the browser containing Ready. Enter the expected public account address and click **Connect and read activation details**. Approve the site connection in Ready if prompted. The page first requests the selected public account, verifies it matches the expected owner, then requests the wallet chain and `wallet_deploymentData` with API 0.10.3. It checks the returned address and recomputes it from class hash, salt and constructor calldata, then displays only those public fields and the Cairo version. Optional `sigdata` is never read or displayed. The connection request reads the selected public account address; it asks for no signature, balance or transaction. Account activation is not performed. A refused connection stops the flow. These semantics follow the [wallet API specification](https://github.com/starkware-libs/starknet-specs/blob/master/wallet-api/wallet_rpc.json).

The activation page has no page network connections, persistence or server upload endpoint. Wallet identity/network changes and timeouts discard pending results. The public owner can be prefilled through a URL fragment, which is removed on page initialization and is not sent to the server. The validator and HTTP boundary have local tests; live Ready deployment-data retrieval and real-browser activation-page behavior remain unverified.

## Unsigned deployment fee request

`node scripts/preview-fees.ts public-account.json public-terms.json block-header.json` builds a local `starknet_estimateFee` request. The block header needs `blockHash` and `starknetVersion`, obtained from the selected mainnet block. The request contains sequential query-version account activation, probe declaration and exact UDC deployment, with no signatures and `SKIP_VALIDATE`. The owner must still be undeployed and the probe undeclared at the selected block. Reconcile those states before sending it. This CLI makes no network request. Its output includes the complete Sierra class and ABI, so sharing it discloses source-derived code to the recipient.

A read-only activation estimate succeeded with user-supplied public Ready account metadata. The response and integer resource-total validation are recorded in `evidence/activation-fee-observation.json`. Signature validation was skipped; this was a preliminary estimate, not a spending cap or total test budget. The combined request was subsequently sent with explicit code-disclosure approval. The accepted request uses hexadecimal execute calldata and the pinned SDK's canonical ABI spacing so the wire class matches the local class hash. It returned three estimates without submitting transactions; see `evidence/deployment-fee-observation.json`. Activation and privacy registration later executed in separate transactions; collection, protocol-fee treatment, and recovery costs remain unresolved.

## Verify a collection receipt

After building, save the deployment preview's `collectionConfiguration` object as a public JSON manifest. Run `node scripts/verify-collection.ts public-configuration.json transaction-hash note-id` with the actual transaction hash and signed note ID. The command reads public mainnet data from Cartridge and prints a summary, never raw receipt or trace payloads. It neither submits nor retries a transaction. Exit code 0 requires `confirmed`; code 2 means an unresolved, reverted or mismatched result; code 1 indicates invalid input or a command failure. `--help` performs no network request.

Confirmation requires an accepted successful INVOKE receipt, the requested transaction in the canonical block, exact VOW `Collected` and pool `OpenNoteDeposited` events in order, matching block-pinned class/configuration/state reads, and a trace showing the pool's exact VOW callback and subsequent token pull. The canonical block is checked again after verification. Receipt/status handling follows the [Starknet RPC specification](https://github.com/starkware-libs/starknet-specs/blob/master/api/starknet_api_openrpc.json), and call-path checks follow its [trace schema](https://github.com/starkware-libs/starknet-specs/blob/master/api/starknet_trace_api_openrpc.json). Pool event decoding is tied to the recorded ABI and pinned pool class.

A missing trace produces `receipt-matched` with the call path unverified. Missing transactions, read failures, pre-confirmed receipts and changed canonical blocks cannot establish confirmation or permission to retry. A confirmed result remains a single-provider observation; it does not decrypt ownership or prove supplier wallet discovery. Positive receipt and trace fixtures are synthetic, and no VOW mainnet transaction has been verified. See `evidence/collection-reconciliation-checks.json`.

`SubmissionAttempt` models one approved review digest through signing, submission and reconciliation. `SubmissionJournal` coordinates same-origin clients with Web Locks and stores only a reservation scope, public note ID and checkpoint. `runJournaledSubmission` persists and reads back the attempt before invoking a caller-supplied dispatcher. It saves late transaction hashes after timeout, returns a known hash even if later storage writes fail, and refuses another attempt for the same chain/vault/reservation even when the review digest or note changes. Restoration starts unknown; matching receipt evidence must be checked again. Native Node Web Locks and simulated storage tests cover concurrency and controller replacement; browser storage/reload behavior has not been tested in a real browser.

The collection page now provides **Read saved attempt** and **Check public receipt** after public terms are validated. These controls make no wallet write and do not store typed inputs. Editing terms or receipt inputs clears old results; late responses for changed terms are discarded. The page still has no submission button. Durable records are created only when an integration invokes the journaled dispatcher.

`reviewCollectionSubmission` independently checks the supplier signature and exact prepared call, normalizes wire fields, fingerprints the call/proof and binds the review to the proposed fee limits. The payload can be released once using the matching digest, before the earlier of five minutes or the claim deadline. Proof data is excluded from the public review and journal. The [Wallet API 0.10.3](https://github.com/starkware-libs/starknet-specs/blob/v0.10.3/wallet-api/wallet_rpc.json) accepts this as a single `invoke_transaction` plus `proof`. It does not accept network resource bounds or a network-fee cap from the dapp. The utility explicitly reports manual wallet confirmation for network fees and does not assess the total budget. Fresh preflight, complete budget review and actual wallet approval remain required before enabling dispatch.

## Four-stage setup simulation

Add `--include-funding` to the fee-preview command to include the exact approve-and-fund batch at nonce 3. The CLI still builds its payload locally and sends nothing. Confirm the selected block has sufficient public principal balance as well as an undeployed account and undeclared probe before estimation. `parseFeeEstimates` validates all four resource totals and rejects a missing fourth result.

The accepted four-stage request and response are identified by SHA-256 and block in `evidence/submission-fee-observation.json`. The updated builder was compared against the exact sent request, with identical parameters. The full 115-test suite passed; no new real-browser check was performed. See `evidence/four-stage-preparation-checks.json`.

Deployment preflight also reads `get_public_key(owner)` at the pinned block. Zero is reported as not registered; a nonzero value is reported only as a public key being present, without claiming wallet access or collection support. RPC errors are not converted to absence. This tool never reads encrypted or unencrypted private keys.

## Activated wallet and deployment review

The owner is already activated and privacy-registered; do not repeat either setup step. Accepted receipts record a 0.055724097349665504 STRK owner-paid activation fee and a separate 6.1 STRK owner transfer during **Enable private tokens**. The registration transaction's 2.885883499721302016 STRK gas was paid by its relayer. See `evidence/owner-activation-receipt.json` and `evidence/registration-receipt-observation.json`.

For an already deployed wallet, use `--deployed-owner` with the fee-preview CLI. The public-account file then contains exactly `address`, `nonce`, `version` and `blockHash`; read nonce and account state from that same pinned block. `--include-funding` adds the exact approval and funding batch. The query never repeats activation and rejects mismatched owner/block or overflowing nonce.

Open `/deployment` on the local diagnostic server to paste public deployment terms and derive the predicted address, constructor, exact calls and collection configuration. Optionally place an explicitly reviewed public draft at `dist/deployment/draft.json` and use **Load local draft**. The server exposes only this allowlisted file; inputs are not stored. The page makes no wallet or external RPC requests and does not prove deployment or funding.

`runCollectionDispatch` connects the existing reviewed payload and journal to an injected wallet adapter. Before its one write, it requires fresh contract and same-origin budget preflights and checks the wallet API, exact account, chain and invalidation events. The collection page enables the write only when `/collection/budget.json` matches the exact configuration, review digest, network cap, all eight cost categories, a five-minute STRK/USD quote, and the $5 ceiling. No approved budget manifest is shipped. Timeout fences late preflight; late submitted hashes remain recoverable. Tests use synthetic wallets and storage; no live wallet submission is claimed. Full combined suite: 165 tests passed.
