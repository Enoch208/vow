# Threat model

VOW is experimental. Its matching VowVault class is deployed on Starknet mainnet, with one controlled 0.1 STRK mandate fully reserved in an open reservation. No supplier collection or payment has occurred, deployed pool behavior through VOW remains unproven, and the implementation is not audited.

The intended authority boundaries are owner funding, operator-limited reservations, supplier-authorized note collection, and a pinned STRK20 pool. An operator must never inherit owner withdrawal authority or supplier signing authority. A relayer may submit signed data but cannot change its destination, amount, network, or contract.

Release-blocking attacks include note substitution, signature replay across domains, repeated collection, deadline races, wrong pool or token, mismatched funding, failed token pull, stale allowances, reentrancy, over-reservation, and owner recovery of reserved funds. Each implemented guard requires a corresponding negative test; unimplemented behavior remains proposed.

The pool must pull the exact approved amount atomically after the helper returns its deposit instruction. Local pool doubles can test rollback assumptions but cannot prove deployed pool behavior. A live compatibility record and pinned class hash are required before claiming integration.

Wallet responses and RPC results are untrusted inputs. Preparation must be structurally decoded, not searched for a plausible note identifier. Unknown transaction outcomes must be reconciled before retry. Missing verification facts must never become successful checks.

Endpoint compromise can expose local keys and permission bundles. An authorized operator can leak permissions it knows or lock approved funds until expiry. Encryption at rest does not protect an unlocked compromised browser. Use small explicitly authorized amounts for experiments; local tests do not establish production-fund safety.

## Collection preparation controller

The public deployment manifest is an expected configuration that requires review; it is not a trusted chain attestation. The controller verifies its terms against one RPC provider at a pinned block and rejects stale blocks, code changes, insufficient public escrow, stale allowance, paused pools, and mismatched terms. A compromised provider can lie; preflight cannot rule out state changes after the final read. The contract remains authoritative at execution.

Wallet API advertisement does not prove correct implementation. Note ownership and proof correctness remain wallet/pool assumptions; structural calldata validation and a valid supplier claim signature do not independently prove them. The controller asks the wallet to simulate, validates the candidate, accepts only the bound supplier's signature, then requests proof preparation and revalidates the exact note. The controller itself does not submit; release to a caller consumes the prepared artifact once and requires fresh preflight. The product claim route is that caller: it separately performs explicit review, journaled wallet submission, receipt verification and unknown-outcome reconciliation.

## Supplier claim-key lifecycle

The supplier owns a separate claim key. The local tool requires an encrypted-backup restoration before presenting its public key for deployment. Authenticated encryption rejects altered backup metadata or ciphertext; weak passwords remain susceptible to guessing. There is no server recovery or key rotation for the immutable experiment. A lost key prevents supplier collection; the probe's owner recovery rules remain governed by its deadline.

The signing page runs on a separate loopback origin with page network connections disabled. It checks the supplied digest, experiment context, bound public key and deadline, and requires explicit term review. A malicious claim with a self-consistent digest can still deceive a supplier who does not compare the terms against the intended reservation. The offline page cannot independently establish chain state or encrypted note ownership. Browser compromise and malicious local asset replacement remain outside these protections.

Unknown cost estimates cannot count as zero. Budget assessment includes activation, deployment, principal, collection and recovery costs, but depends on truthful estimates and a fresh quote. The utility does not enforce a wallet spending limit or account for exchange-rate movement after the quote.

## Deployment prerequisites

An undeployed account, undeclared probe class and an unavailable RPC require different recovery actions. Only the specific missing-contract or missing-class response is interpreted as absence. Malformed envelopes, mismatched IDs, unexpected error codes and transport failures remain failures. Dependency reads use one nonzero block hash and a freshness check. These checks rely on one RPC and do not authenticate its answers or verify UDC/token source.

Public wallet deployment data is accepted only if its class hash, salt and constructor derive the expected account address. A mismatched selected account or altered constructor is rejected. This binding establishes address consistency, not correct account implementation, valid guardian authorization, fee sufficiency or successful activation. No optional signature material is exposed by the metadata page.

Unsigned fee queries use the query transaction version and empty signatures. `SKIP_VALIDATE` excludes account signature validation from the estimate; its result cannot establish a complete fee cap, transaction validity or authorization. The fee parser requires FRI units, the exact response count and agreement between gas-resource products and total fee. A stale block, changed account deployment status or changed nonce requires a fresh plan.

## Receipt verification and uncertain submissions

A successful unrelated pool transaction is not VOW payment evidence. The VowVault verifier requires exactly one `ReservationClaimed` event from the pinned vault, its matching claimed reservation and pool deposit, accepted execution, pinned vault/pool classes and the corresponding callback/token-pull trace. Duplicate or altered events fail closed. It checks canonical block membership before and after the reads, but a later reorganization can still change an observation. The RPC provider and token/pool implementations remain trust dependencies; these checks do not independently authenticate consensus or encrypted note ownership.

The submission journal serializes cooperating same-origin clients with Web Locks and writes a reservation-scoped attempt before dispatch. A different note or review digest cannot bypass an existing record. Missing, corrupt or unwritable storage fails closed. Timeouts preserve the attempt, late hashes are recorded, and conflicting hashes remain quarantined. Restored records never establish cached confirmation. Clearing storage, using another origin/browser or bypassing the journal defeats client-side coordination; the contract must still enforce single use.

Submission reviews bind the exact prepared call/proof and proposed fee limits, expire within five minutes, and release the payload once. The Wallet API has no dapp-supplied network-fee-cap parameter; binding a proposed cap into a review cannot enforce it in the wallet. The wallet confirmation must be checked against the reviewed budget. Actual wallet dispatch remains disabled in the workbench; the journaled dispatcher is tested with synthetic callbacks.
