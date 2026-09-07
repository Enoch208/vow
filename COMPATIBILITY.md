# Compatibility

Status: G0 pending. No VOW deployment, mainnet transaction, token choice, or complete wallet capability has been verified.

The user supplied a screenshot identifying Ready X 5.33.9 and a separate screenshot with Mainnet selected. This is version/network UI evidence, not proof of STRK20 API support. No private key or recovery phrase is required for capability testing.

The [official Day 0 guide](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md) says ordinary Starknet wallet support does not establish support for the STRK20 Wallet API. The guide identifies `wallet_strk20Balances` as a read-only probe. A successful balance probe alone does not establish preparation, exact note binding, proving, or submission support.

The [helper interface documentation](https://strk20-by-example.org/helpers/privacy-invoke) describes `OpenNoteDeposit` as note ID, token address, and u128 amount. The helper returns deposits and approves the pool; the pool performs the pull. The deployed ABI and class still require independent verification.

The [wallet documentation](https://strk20-by-example.org/starknet-wallet-api/overview) identifies starknet.js 10.4.0 as the STRK20 API release. VOW pins that version for source inspection and local compatibility work. Dependency availability is not live compatibility evidence.

Pending: functional wallet preparation and submission, actual prepared payload shape, stable destination across re-preparation, supported token behavior, screening, fee-token compatibility, and a successful bound collection receipt. Owner privacy registration is verified separately below; it does not establish collection support. The read-only pool observations below resolve initial chain/class discovery; they must be refreshed before live execution.

## Recorded mainnet reads

`evidence/pool-observation.json` records a successful public RPC read pinned to mainnet block 14478829. The pool class was `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`; the ABI is stored in `evidence/pool-abi.json` with its SHA-256 digest in the observation. The pool reported version `2.0`, unpaused status, a fee amount, and a fee collector. The fee's economic interpretation and required token path still need verification.

The deployed ABI exposes `is_open_note_depositor_blocked` and `set_open_note_depositor_blocked`; the inspected current upstream source instead exposes a screening-policy mechanism. Do not substitute current source for this deployment. Source-to-class matching remains unverified.

The decoder now follows the recorded `apply_actions` / `ServerAction` ABI and rejects a different pool class, malformed/trailing data, mismatched helper/note/token, extra invocation, unexpected public transfers, and fee-budget overruns. Tests use synthetic payloads; no Ready preparation was captured. The helper's signature matches a TypeScript/Cairo claim vector. None of these observations passes G0.

## Local wallet diagnostic

`npm run diagnostic` serves a local read-only check. Wallet Standard discovery uses pinned `@wallet-standard/app` 1.1.1; the Starknet feature shape was inspected in the installed v6 types. The legacy Ready adapter follows the public [inpage injection source](https://github.com/argentlabs/argent-x/blob/e3545daa417d6b60332b6112816d5e3b13c34358/packages/extension/src/inpage/index.ts) and [provider object](https://github.com/argentlabs/argent-x/blob/e3545daa417d6b60332b6112816d5e3b13c34358/packages/extension/src/inpage/starknetWindowObject.ts). These source paths establish a discovery adapter, not the installed wallet's private API capabilities.

Identity-only adapter tests and loopback HTTP security checks pass. A browser check also passed initial-page and rescan assertions while leaving the capability request unrun. A user-supplied diagnostic result from Ready X 5.33.9 reports REQUEST_FAILED; a subsequent screenshot shows Ready unlocked with the same result. The original diagnostic discarded the error code, so the cause remains unknown. The diagnostic now preserves only a bounded numeric error code and omits error messages and data. The subsequent retry returned numeric error 163, as recorded below. A balance-method response will still leave collection unverified until preparation, binding, proving, and settlement are demonstrated.

The user subsequently reported numeric error 163 (UNKNOWN_ERROR). This does not establish its cause. The empty-token probe was replaced with wallet_supportedWalletApi: current installed API definitions specify that an empty token list requests all shielded balances. Prior statements that it requested no balances were incorrect. The version query does not request balances; its subsequent successful result is recorded below.

The replacement wallet_supportedWalletApi query succeeded in user-supplied diagnostic output: Ready X 5.33.9 advertises 0.10.3 and 0.7.2. This confirms version advertisement, not functional collection. The installed Starknet.js 10.4.0 STRK20 wrapper omits the optional api_version parameter, so a missing explicit version is not an established explanation for the earlier error. Next evidence needed is a valid supplier collection preparation against the probe contract, followed by exact destination verification and a separately authorized live settlement.

## Local collection preparation milestone

The probe now exposes its immutable public configuration so the supplier client can independently read and compare terms. This changes its compiled class hash; no older deployment should be treated as matching the new workbench. The workbench builds against the local artifact and requests API 0.10.3 explicitly. The spec defaults omitted versions to the latest, so the earlier balance error is still unexplained.

Local controller tests cover both preparation phases, exact signed-note preservation, wrong keys, wallet network changes, changed reservation state, stale blocks, empty proof data, cancellation and late responses. The controller reads live contracts when a reviewed deployed configuration is supplied, but no real deployed probe configuration has been provided. No live collection, wallet proof-generation success, or final submission capability is claimed. See evidence/collection-workbench-checks.json for the current milestone evidence and remaining checks.

The local deployment-preview builder now constructs owner-bound UDC deployment calldata, a predicted address, an exact approve-plus-fund batch, and a collection manifest. Its source matches the pinned Starknet.js deployer implementation and the [OpenZeppelin UDC interface](https://docs.openzeppelin.com/contracts-cairo/2.x/udc). No UDC mainnet deployment/class check, fee estimate, class declaration, deployment, or funding is implied by producing a preview. All new preview tests use synthetic public terms.

The separate supplier-key tool now restores an encrypted local backup and signs the collection controller's exact public review. A synthetic integration test connects restoration, signing, final preparation validation and one-time artifact release. The empty-state browser check passed without entering secrets or using a wallet. No real supplier key, wallet preparation, deployment or funded claim was part of this check. Total test-budget assessment rejects missing fee estimates; live costs and G0 remain unverified. See `evidence/supplier-tool-checks.json`.

## Deployment prerequisite observation

At mainnet block 14493252, the selected public RPC reported the experiment owner's account absent, its public STRK balance zero and the locally built probe class undeclared. The UDC address had code; the pool class matched the recorded decoder class and the pool was unpaused. STRK reported 18 decimals. The exact timestamp and class hashes are in `evidence/deployment-readiness-observation.json`. UDC/token source matching, pool fee denomination, token collection support and total live fees remain unverified.

The activation-data adapter is based on the installed API 0.10.3 types and current official wallet specification. Local tests check exact address derivation and exclusion of optional signature data. Ready refused the initial request without returning a numeric error code or metadata. Its specification requires an approved site connection. The page now requests that connection explicitly on click, verifies the selected public account and then reads deployment metadata. This addresses the missing connection step; actual Ready deployment data remains unverified until a successful response. No deployment is requested.

Ready X 5.33.9 returned public account-deployment data after explicit connection. The local validator recomputed the supplied wallet address from its class, salt and constructor. The subsequent single-provider unsigned activation estimate at block 14493757 returned 54,795,426,350,986,816 FRI (0.054795426350986816 STRK), with validation skipped. This is not a validated wallet fee cap, account activation, or collection compatibility pass. Combined estimation subsequently succeeded as recorded below; no complete $5-budget assessment is claimed.

With user approval to disclose the compiled contract class, the unsigned activation/declaration/deployment sequence succeeded at block 14494128 on Starknet 0.14.3. Estimates were 0.054738208605252128, 11.513579678193121344 and 0.1185680687956568 STRK respectively, totaling 11.686885955594030272 STRK. A timestamped STRK/USD quote at 0.03082924 valued that subtotal at approximately $0.36. Signature validation was skipped. This is simulation evidence only, not an actual declaration, deployed helper or complete test budget.

The initial requests exposed decimal execute-calldata encoding and ABI-spacing discrepancies. Both were corrected and covered in the local regression suite. The full 77-test suite passed after those corrections. The successful RPC result and quote timestamps are in `evidence/deployment-fee-observation.json`; earlier rejected attempts are retained separately in the fee-check record.

## Four-stage estimate and registration observation

At block 14507124, Cartridge estimated activation, declaration, deployment and atomic funding at a combined 11.575312991845563696 STRK, excluding signature validation. The public owner balance was 191.37120052 STRK and the pool returned zero from `get_public_key(owner)`. These observations are recorded in `evidence/submission-fee-observation.json`, `evidence/submission-readiness-observation.json` and `evidence/recipient-registration-observation.json`. They do not establish full-budget compliance or G0.

The [Wallet API 0.10.3 specification](https://github.com/starkware-libs/starknet-specs/blob/v0.10.3/wallet-api/wallet_rpc.json) defines error 163 as UNKNOWN_ERROR and 118 as NOT_REGISTERED; private transfers require a registered recipient. The earlier 163 result therefore does not establish lack of wallet support or a registration-specific error. The later setup receipt is verified below; actual VOW preparation remains to be verified.

## Verified wallet setup

The supplied Ready **Enable private tokens** transaction was successful and accepted on L2 at block 14510239. Its pool `ViewingKeySet` event matched the owner and recorded public key. The owner transferred 6.1 STRK into the setup flow; the receipt network fee of 2.885883499721302016 STRK was paid by the transaction sender, a different address, and is not added again to owner outflow. Separate account activation succeeded with an owner-paid fee of 0.055724097349665504 STRK. Completed owner outflow is therefore 6.155724097349665504 STRK. The 6.1 STRK transfer is not classified entirely as fees. The pool's raw fee value is 6000000000000000000, which would equal 6 STRK if it is STRK-denominated with 18 decimals, but its denomination, payment path, and relationship to the observed 6.1 STRK transfer remain unverified. See `evidence/registration-receipt-observation.json` and `evidence/owner-activation-receipt.json`. No private balance or note ownership was read or verified.

At block 14515326 the owner was already deployed with nonce 1. The revised unsigned fee query omitted activation and estimated declaration, deployment, and funding network fees at 11.52476084897244256 STRK in total, with signature validation skipped. Including the completed 6.155724097349665504 STRK owner outflow and proposed 0.1 STRK VOW principal gives a partial projected owner outflow of 17.780484946322108064 STRK. Collection gas, wallet/prover charges, protocol-fee treatment, recovery reserve, and final wallet fee limits remain unknown, so this is not a full test budget or spending cap. G0 remains unproven.
