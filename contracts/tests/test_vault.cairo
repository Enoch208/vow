use snforge_std::{
    start_cheat_block_timestamp, start_cheat_caller_address, stop_cheat_caller_address,
};
use vow_collection_probe::interfaces::{
    IERC20DispatcherTrait, IVowVaultDispatcherTrait, IVowVaultSafeDispatcherTrait,
};
use vow_collection_probe::permissions::{hash_permission, root_from_proof};
use vow_collection_probe::records::{RESERVATION_CLAIMED, RESERVATION_EXPIRED, RESERVATION_OPEN};
use crate::support::token::ITestTokenDispatcherTrait;
use crate::support::vault_pool::{IVaultPoolDispatcherTrait, IVaultPoolSafeDispatcherTrait};
use crate::vault_support::{
    MANDATE, OWNER, ROOT, authorization, create_mandate, fund, operator_signature, permission,
    proof, safe_pool, safe_vault, setup, supplier_signature,
};

fn reserve(f: crate::vault_support::Fixture, slot: u32, cap: u128, amount: u128) -> felt252 {
    let leaf = permission(slot, cap, f.supplier.public_key);
    let auth = authorization(leaf, hash_permission(leaf), amount, 55 + slot.into());
    let (r, s) = operator_signature(f, auth);
    f.vault.reserve(auth, leaf, proof(slot), r, s)
}

#[test]
fn t_002_permission_vector_and_proof_match_the_typescript_tree() {
    let f = setup();
    let leaf = permission(0, 40, f.supplier.public_key);
    let leaf_hash = hash_permission(leaf);
    assert(
        leaf_hash == 0x5e3a4b1c5a610d43d66077cddaddf3f076e2c057d3dba85dd8967cdf162debe,
        'LEAF_VECTOR_MISMATCH',
    );
    assert(root_from_proof(leaf_hash, 0, proof(0).span()) == ROOT, 'ROOT_MISMATCH');
    let second = permission(1, 30, f.supplier.public_key);
    assert(
        root_from_proof(hash_permission(second), 1, proof(1).span()) == ROOT, 'SECOND_ROOT_MISMATCH',
    );
}

#[test]
fn t_003_reservations_cannot_exceed_available_funds() {
    let f = setup();
    let mandate_id = create_mandate(f);
    assert(mandate_id == MANDATE, 'BAD_MANDATE_ID');
    fund(f, mandate_id, 50);
    assert(f.vault.mandate_available(mandate_id) == 50, 'BAD_AVAILABLE');

    reserve(f, 0, 40, 40);
    assert(f.vault.mandate_available(mandate_id) == 10, 'AVAILABLE_NOT_REDUCED');
    let mandate = f.vault.mandate(mandate_id);
    assert(mandate.reserved == 40, 'BAD_RESERVED');
    assert(mandate.funded >= mandate.reserved + mandate.paid + mandate.reclaimed, 'OVER_RESERVED');

    reserve(f, 1, 30, 10);
    assert(f.vault.mandate_available(mandate_id) == 0, 'AVAILABLE_NOT_ZERO');
    let mandate = f.vault.mandate(mandate_id);
    assert(mandate.reserved == 50, 'BAD_TOTAL_RESERVED');
    assert(mandate.funded == mandate.reserved + mandate.paid + mandate.reclaimed, 'BROKEN_BOOKS');
}

#[test]
#[feature("safe_dispatcher")]
fn t_003_a_third_individually_valid_approval_cannot_overdraw() {
    let f = setup();
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 50);
    reserve(f, 0, 40, 40);
    let leaf = permission(1, 30, f.supplier.public_key);
    let auth = authorization(leaf, hash_permission(leaf), 30, 56);
    let (r, s) = operator_signature(f, auth);
    assert(safe_vault(f).reserve(auth, leaf, proof(1), r, s).is_err(), 'OVERDRAWN');
    assert(f.vault.mandate_available(mandate_id) == 10, 'AVAILABLE_CHANGED');
    assert(!f.vault.permission_consumed(mandate_id, 1), 'PERMISSION_BURNED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_004_a_consumed_permission_cannot_reserve_again_after_expiry() {
    let f = setup();
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 100);
    let reservation_id = reserve(f, 0, 40, 40);
    assert(f.vault.permission_consumed(mandate_id, 0), 'NOT_CONSUMED');

    let leaf = permission(0, 40, f.supplier.public_key);
    let auth = authorization(leaf, hash_permission(leaf), 40, 99);
    let (r, s) = operator_signature(f, auth);
    assert(safe_vault(f).reserve(auth, leaf, proof(0), r, s).is_err(), 'DOUBLE_RESERVE');

    start_cheat_block_timestamp(f.vault.contract_address, 2000);
    f.vault.expire_reservation(reservation_id);
    assert(f.vault.reservation(reservation_id).state == RESERVATION_EXPIRED, 'NOT_EXPIRED');
    assert(f.vault.mandate_available(mandate_id) == 100, 'FUNDS_NOT_RETURNED');
    assert(f.vault.permission_consumed(mandate_id, 0), 'PERMISSION_REARMED');
    assert(safe_vault(f).reserve(auth, leaf, proof(0), r, s).is_err(), 'REUSED_AFTER_EXPIRY');
}

#[test]
#[feature("safe_dispatcher")]
fn t_008_a_reservation_has_exactly_one_terminal_outcome() {
    let f = setup();
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 100);
    let reservation_id = reserve(f, 0, 40, 40);
    let (r, s) = supplier_signature(f, reservation_id, 777, 1900);
    f.pool.collect(f.vault.contract_address, reservation_id, 777, 1900, r, s);
    assert(f.vault.reservation(reservation_id).state == RESERVATION_CLAIMED, 'NOT_CLAIMED');
    assert(f.pool.credited(777) == 40, 'NOT_CREDITED');

    let mandate = f.vault.mandate(mandate_id);
    assert(mandate.paid == 40, 'BAD_PAID');
    assert(mandate.reserved == 0, 'RESERVED_NOT_RELEASED');
    assert(f.vault.mandate_available(mandate_id) == 60, 'BAD_AVAILABLE');

    start_cheat_block_timestamp(f.vault.contract_address, 2000);
    assert(safe_vault(f).expire_reservation(reservation_id).is_err(), 'EXPIRED_AFTER_CLAIM');
}

#[test]
#[feature("safe_dispatcher")]
fn t_009_revocation_stops_new_approvals_and_preserves_open_claims() {
    let f = setup();
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 100);
    let reservation_id = reserve(f, 0, 40, 40);

    start_cheat_caller_address(f.vault.contract_address, OWNER);
    f.vault.revoke_mandate(mandate_id);
    stop_cheat_caller_address(f.vault.contract_address);
    assert(f.vault.mandate(mandate_id).revoked, 'NOT_REVOKED');

    let leaf = permission(1, 30, f.supplier.public_key);
    let auth = authorization(leaf, hash_permission(leaf), 30, 56);
    let (r, s) = operator_signature(f, auth);
    assert(safe_vault(f).reserve(auth, leaf, proof(1), r, s).is_err(), 'RESERVED_AFTER_REVOKE');

    let (r, s) = supplier_signature(f, reservation_id, 777, 1900);
    f.pool.collect(f.vault.contract_address, reservation_id, 777, 1900, r, s);
    assert(f.pool.credited(777) == 40, 'CLAIM_LOST_ON_REVOKE');
}

#[test]
#[feature("safe_dispatcher")]
fn t_010_owner_reclaim_excludes_every_open_reservation() {
    let f = setup();
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 100);
    reserve(f, 0, 40, 40);

    start_cheat_caller_address(f.vault.contract_address, OWNER);
    assert(safe_vault(f).reclaim_available(mandate_id, 61, OWNER).is_err(), 'RECLAIMED_RESERVED');
    f.vault.reclaim_available(mandate_id, 60, OWNER);
    assert(f.vault.mandate_available(mandate_id) == 0, 'BAD_AVAILABLE');
    assert(f.vault.mandate(mandate_id).reserved == 40, 'RESERVATION_TOUCHED');
    assert(f.token.balance_of(f.vault.contract_address) == 40, 'RESERVED_FUNDS_LEFT');
    assert(safe_vault(f).reclaim_available(mandate_id, 1, OWNER).is_err(), 'RECLAIMED_TWICE');
}

#[test]
#[feature("safe_dispatcher")]
fn t_014_donated_tokens_never_increase_mandate_accounting() {
    let f = setup();
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 50);
    f.token_control.mint(f.vault.contract_address, 500);
    assert(f.vault.mandate_available(mandate_id) == 50, 'DONATION_COUNTED');
    assert(f.vault.accounted_balance(f.token.contract_address) == 50, 'ACCOUNTING_INFLATED');

    start_cheat_caller_address(f.vault.contract_address, OWNER);
    assert(safe_vault(f).reclaim_available(mandate_id, 51, OWNER).is_err(), 'DONATION_DRAINED');
    let leaf = permission(0, 40, f.supplier.public_key);
    let auth = authorization(leaf, hash_permission(leaf), 40, 55);
    let (r, s) = operator_signature(f, auth);
    f.vault.reserve(auth, leaf, proof(0), r, s);
    assert(f.vault.mandate_available(mandate_id) == 10, 'DONATION_RESERVABLE');
}

#[test]
#[feature("safe_dispatcher")]
fn t_013_a_failed_pool_pull_rolls_back_the_whole_collection() {
    let f = setup();
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 100);
    let reservation_id = reserve(f, 0, 40, 40);
    f.token_control.mode(2);
    let (r, s) = supplier_signature(f, reservation_id, 777, 1900);
    assert(
        safe_pool(f).collect(f.vault.contract_address, reservation_id, 777, 1900, r, s).is_err(),
        'PULL_SUCCEEDED',
    );
    assert(f.vault.reservation(reservation_id).state == RESERVATION_OPEN, 'STATE_ADVANCED');
    assert(f.vault.mandate(mandate_id).paid == 0, 'PAID_ADVANCED');
    assert(f.token.balance_of(f.vault.contract_address) == 100, 'FUNDS_MOVED');

    f.token_control.mode(0);
    let (r, s) = supplier_signature(f, reservation_id, 777, 1900);
    f.pool.collect(f.vault.contract_address, reservation_id, 777, 1900, r, s);
    assert(f.pool.credited(777) == 40, 'RETRY_FAILED');
}
