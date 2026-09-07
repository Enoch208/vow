use snforge_std::{
    start_cheat_block_timestamp, start_cheat_caller_address, stop_cheat_caller_address,
};
use vow_collection_probe::interfaces::{
    IVowVaultDispatcherTrait, IVowVaultSafeDispatcherTrait, MandateTerms,
};
use vow_collection_probe::permissions::hash_permission;
use vow_collection_probe::records::RESERVATION_OPEN;
use crate::support::vault_pool::{IVaultPoolDispatcherTrait, IVaultPoolSafeDispatcherTrait};
use crate::vault_support::{
    EXPIRES_AT, Fixture, OUTSIDER, OWNER, ROOT, TOKEN_ADDRESS, authorization, create_mandate, fund,
    impostor_signature, operator_signature, permission, proof, safe_pool, safe_vault, setup,
    supplier_signature,
};

fn funded(f: Fixture) -> felt252 {
    let mandate_id = create_mandate(f);
    fund(f, mandate_id, 100);
    mandate_id
}

fn open_reservation(f: Fixture) -> felt252 {
    let leaf = permission(0, 40, f.supplier.public_key);
    let auth = authorization(leaf, hash_permission(leaf), 40, 55);
    let (r, s) = operator_signature(f, auth);
    f.vault.reserve(auth, leaf, proof(0), r, s)
}

#[test]
#[feature("safe_dispatcher")]
fn t_005_the_operator_signature_cannot_be_moved_to_another_request() {
    let f = setup();
    funded(f);
    let leaf = permission(0, 40, f.supplier.public_key);
    let signed = authorization(leaf, hash_permission(leaf), 40, 55);
    let (r, s) = operator_signature(f, signed);

    let larger = authorization(leaf, hash_permission(leaf), 41, 55);
    assert(safe_vault(f).reserve(larger, leaf, proof(0), r, s).is_err(), 'AMOUNT_SWAPPED');

    let renumbered = authorization(leaf, hash_permission(leaf), 40, 56);
    assert(safe_vault(f).reserve(renumbered, leaf, proof(0), r, s).is_err(), 'REQUEST_SWAPPED');

    let mut rerooted = signed;
    rerooted.immutable_root = ROOT + 1;
    assert(safe_vault(f).reserve(rerooted, leaf, proof(0), r, s).is_err(), 'ROOT_SWAPPED');

    let mut remandated = signed;
    remandated.mandate_id = 2;
    assert(safe_vault(f).reserve(remandated, leaf, proof(0), r, s).is_err(), 'MANDATE_SWAPPED');

    f.vault.reserve(signed, leaf, proof(0), r, s);
}

#[test]
#[feature("safe_dispatcher")]
fn t_005_an_impostor_operator_key_cannot_authorize_a_reservation() {
    let f = setup();
    funded(f);
    let leaf = permission(0, 40, f.supplier.public_key);
    let auth = authorization(leaf, hash_permission(leaf), 40, 55);
    let (r, s) = impostor_signature(f, auth);
    assert(safe_vault(f).reserve(auth, leaf, proof(0), r, s).is_err(), 'SUPPLIER_AUTHORIZED');
    assert(safe_vault(f).reserve(auth, leaf, proof(0), 0, 0).is_err(), 'ZERO_SIGNATURE_ACCEPTED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_002_an_altered_permission_or_proof_cannot_reserve() {
    let f = setup();
    let mandate_id = funded(f);
    let raised = permission(0, 4000, f.supplier.public_key);
    let auth = authorization(raised, hash_permission(raised), 100, 55);
    let (r, s) = operator_signature(f, auth);
    assert(safe_vault(f).reserve(auth, raised, proof(0), r, s).is_err(), 'RAISED_CAP_ACCEPTED');

    let honest = permission(0, 40, f.supplier.public_key);
    let auth = authorization(honest, hash_permission(honest), 40, 55);
    let (r, s) = operator_signature(f, auth);
    assert(safe_vault(f).reserve(auth, honest, proof(2), r, s).is_err(), 'WRONG_PROOF_ACCEPTED');
    assert(safe_vault(f).reserve(auth, honest, array![], r, s).is_err(), 'EMPTY_PROOF_ACCEPTED');
    assert(f.vault.mandate_available(mandate_id) == 100, 'FUNDS_MOVED');
    assert(!f.vault.permission_consumed(mandate_id, 0), 'PERMISSION_BURNED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_002_a_permission_bound_to_another_supplier_cannot_borrow_a_proof() {
    let f = setup();
    funded(f);
    let substituted = permission(0, 40, f.operator.public_key);
    let auth = authorization(substituted, hash_permission(substituted), 40, 55);
    let (r, s) = operator_signature(f, auth);
    assert(
        safe_vault(f).reserve(auth, substituted, proof(0), r, s).is_err(), 'SUPPLIER_REPLACED',
    );
}

#[test]
#[feature("safe_dispatcher")]
fn t_012_a_permission_naming_another_token_is_rejected() {
    let f = setup();
    funded(f);
    let mut foreign = permission(0, 40, f.supplier.public_key);
    foreign.token = 4040.try_into().unwrap();
    let auth = authorization(foreign, hash_permission(foreign), 40, 55);
    let (r, s) = operator_signature(f, auth);
    assert(safe_vault(f).reserve(auth, foreign, proof(0), r, s).is_err(), 'TOKEN_SWAPPED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_011_only_the_configured_pool_can_settle_a_reservation() {
    let f = setup();
    funded(f);
    let reservation_id = open_reservation(f);
    let (r, s) = supplier_signature(f, reservation_id, 777, 1900);
    assert(
        safe_vault(f).privacy_invoke('CLAIM', reservation_id, 777, 1900, r, s).is_err(),
        'DIRECT_CALL_SETTLED',
    );
    start_cheat_caller_address(f.vault.contract_address, OUTSIDER);
    assert(
        safe_vault(f).privacy_invoke('CLAIM', reservation_id, 777, 1900, r, s).is_err(),
        'OUTSIDER_SETTLED',
    );
    stop_cheat_caller_address(f.vault.contract_address);
    assert(f.vault.reservation(reservation_id).state == RESERVATION_OPEN, 'STATE_ADVANCED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_006_a_supplier_signature_cannot_be_moved_to_another_note() {
    let f = setup();
    funded(f);
    let reservation_id = open_reservation(f);
    let (r, s) = supplier_signature(f, reservation_id, 777, 1900);
    assert(
        safe_pool(f).collect(f.vault.contract_address, reservation_id, 778, 1900, r, s).is_err(),
        'NOTE_SWAPPED',
    );
    assert(
        safe_pool(f).collect(f.vault.contract_address, reservation_id, 0, 1900, r, s).is_err(),
        'ZERO_NOTE_ACCEPTED',
    );
    assert(f.vault.reservation(reservation_id).state == RESERVATION_OPEN, 'STATE_ADVANCED');
    f.pool.collect(f.vault.contract_address, reservation_id, 777, 1900, r, s);
}

#[test]
#[feature("safe_dispatcher")]
fn t_007_claim_after_deadline_and_expiry_before_deadline_are_both_rejected() {
    let f = setup();
    funded(f);
    let reservation_id = open_reservation(f);
    assert(safe_vault(f).expire_reservation(reservation_id).is_err(), 'EARLY_EXPIRY');

    let (r, s) = supplier_signature(f, reservation_id, 777, 2001);
    assert(
        safe_pool(f).collect(f.vault.contract_address, reservation_id, 777, 2001, r, s).is_err(),
        'DEADLINE_EXTENDED',
    );

    start_cheat_block_timestamp(f.vault.contract_address, 2000);
    let (r, s) = supplier_signature(f, reservation_id, 777, 1900);
    assert(
        safe_pool(f).collect(f.vault.contract_address, reservation_id, 777, 1900, r, s).is_err(),
        'LATE_CLAIM',
    );
    f.vault.expire_reservation(reservation_id);
}

#[test]
#[feature("safe_dispatcher")]
fn fr_01_no_outsider_can_replace_authority_or_drain_a_funded_mandate() {
    let f = setup();
    let mandate_id = funded(f);
    let before = f.vault.mandate(mandate_id);

    start_cheat_caller_address(f.vault.contract_address, OUTSIDER);
    assert(safe_vault(f).revoke_mandate(mandate_id).is_err(), 'OUTSIDER_REVOKED');
    assert(
        safe_vault(f).reclaim_available(mandate_id, 100, OUTSIDER).is_err(), 'OUTSIDER_RECLAIMED',
    );
    assert(safe_vault(f).fund_mandate(mandate_id, 10).is_err(), 'OUTSIDER_FUNDED');
    let hostile = f
        .vault
        .create_mandate(
            MandateTerms {
                owner: OUTSIDER, root: ROOT, operator_key: f.operator.public_key,
                token: TOKEN_ADDRESS, expires_at: EXPIRES_AT,
            },
        );
    stop_cheat_caller_address(f.vault.contract_address);

    assert(hostile != mandate_id, 'MANDATE_OVERWRITTEN');
    let after = f.vault.mandate(mandate_id);
    assert(after.owner == before.owner, 'OWNER_REPLACED');
    assert(after.root == before.root, 'ROOT_REPLACED');
    assert(after.operator_key == before.operator_key, 'OPERATOR_REPLACED');
    assert(after.funded == before.funded, 'FUNDING_CHANGED');
    assert(f.vault.mandate(hostile).funded == 0, 'HOSTILE_INHERITED_FUNDS');
}

#[test]
#[feature("safe_dispatcher")]
fn fr_01_a_mandate_owner_cannot_be_impersonated_at_creation() {
    let f = setup();
    start_cheat_caller_address(f.vault.contract_address, OUTSIDER);
    let terms = MandateTerms {
        owner: OWNER, root: ROOT, operator_key: f.operator.public_key, token: TOKEN_ADDRESS,
        expires_at: EXPIRES_AT,
    };
    assert(safe_vault(f).create_mandate(terms).is_err(), 'OWNER_IMPERSONATED');
    stop_cheat_caller_address(f.vault.contract_address);
}
