use snforge_std::{
    start_cheat_block_timestamp, start_cheat_caller_address, stop_cheat_caller_address,
};
use vow_collection_probe::interfaces::{
    ICollectionProbeDispatcherTrait, ICollectionProbeSafeDispatcherTrait, IERC20DispatcherTrait,
};
use crate::support::pool::{ITestPoolDispatcherTrait, ITestPoolSafeDispatcherTrait};
use crate::support::token::ITestTokenDispatcherTrait;
use crate::support::{OWNER, fund, safe_pool, safe_probe, setup, signature};

#[test]
#[feature("safe_dispatcher")]
fn wrong_owner_cannot_fund_and_funding_cannot_repeat() {
    let f = setup();
    start_cheat_caller_address(f.probe.contract_address, 999.try_into().unwrap());
    assert(safe_probe(f).fund().is_err(), 'WRONG_OWNER_FUNDED');
    start_cheat_caller_address(f.probe.contract_address, OWNER);
    fund(f);
    start_cheat_caller_address(f.probe.contract_address, OWNER);
    start_cheat_caller_address(f.token.contract_address, OWNER);
    f.token.approve(f.probe.contract_address, 100);
    stop_cheat_caller_address(f.token.contract_address);
    assert(safe_probe(f).fund().is_err(), 'DOUBLE_FUND');
    assert(f.token.balance_of(f.probe.contract_address) == 100, 'BAD_BALANCE');
}

#[test]
#[feature("safe_dispatcher")]
fn t_007_signature_deadline_cannot_expire_or_extend() {
    let f = setup();
    fund(f);
    let (r, s) = signature(f, 777, 999);
    assert(
        safe_pool(f).collect(f.probe.contract_address, 777, 999, r, s).is_err(),
        'EXPIRED_SIGNATURE',
    );
    let (r, s) = signature(f, 777, 2001);
    assert(
        safe_pool(f).collect(f.probe.contract_address, 777, 2001, r, s).is_err(),
        'EXTENDED_SIGNATURE',
    );
    assert(f.probe.state() == 1, 'STATE_CHANGED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_013_failed_approval_rolls_back_claim() {
    let f = setup();
    fund(f);
    let (r, s) = signature(f, 777, 1900);
    f.token_control.mode(3);
    assert(
        safe_pool(f).collect(f.probe.contract_address, 777, 1900, r, s).is_err(), 'BAD_APPROVAL',
    );
    assert(f.probe.state() == 1, 'CLAIM_NOT_ROLLED_BACK');
    f.token_control.mode(0);
    f.pool.collect(f.probe.contract_address, 777, 1900, r, s);
}

#[test]
#[feature("safe_dispatcher")]
fn t_013_failed_reclaim_preserves_reservation() {
    let f = setup();
    fund(f);
    start_cheat_block_timestamp(f.probe.contract_address, 2000);
    start_cheat_caller_address(f.probe.contract_address, OWNER);
    f.token_control.mode(4);
    assert(safe_probe(f).reclaim_expired().is_err(), 'TRANSFER_SUCCEEDED');
    assert(f.probe.state() == 1, 'STATE_NOT_ROLLED_BACK');
    assert(f.token.balance_of(f.probe.contract_address) == 100, 'FUNDS_LOST');
    f.token_control.mode(0);
    f.probe.reclaim_expired();
}

#[test]
#[feature("safe_dispatcher")]
fn stale_allowance_blocks_collection() {
    let f = setup();
    fund(f);
    start_cheat_caller_address(f.token.contract_address, f.probe.contract_address);
    f.token.approve(f.pool.contract_address, 1);
    stop_cheat_caller_address(f.token.contract_address);
    let (r, s) = signature(f, 777, 1900);
    assert(
        safe_pool(f).collect(f.probe.contract_address, 777, 1900, r, s).is_err(),
        'STALE_ALLOWANCE_ACCEPTED',
    );
    assert(f.probe.state() == 1, 'STATE_CHANGED');
}

#[test]
#[feature("safe_dispatcher")]
fn wrong_operation_reservation_and_zero_note_are_rejected() {
    let f = setup();
    fund(f);
    start_cheat_caller_address(f.probe.contract_address, f.pool.contract_address);
    let (r, s) = signature(f, 777, 1900);
    assert(safe_probe(f).privacy_invoke('DRAIN', 1, 777, 1900, r, s).is_err(), 'WRONG_OPERATION');
    assert(safe_probe(f).privacy_invoke('CLAIM', 2, 777, 1900, r, s).is_err(), 'WRONG_RESERVATION');
    let (r, s) = signature(f, 0, 1900);
    assert(safe_probe(f).privacy_invoke('CLAIM', 1, 0, 1900, r, s).is_err(), 'ZERO_NOTE');
}

#[test]
#[feature("safe_dispatcher")]
fn t_006_signature_cannot_cross_deployments() {
    let first = setup();
    fund(first);
    let second = setup();
    fund(second);
    let (r, s) = signature(first, 777, 1900);
    assert(
        safe_pool(second).collect(second.probe.contract_address, 777, 1900, r, s).is_err(),
        'CROSS_DEPLOYMENT_SIGNATURE',
    );
    assert(second.probe.state() == 1, 'STATE_CHANGED');
}

#[test]
fn configuration_exposes_the_immutable_collection_terms() {
    let f = setup();
    let config = f.probe.configuration();
    assert(config.owner == OWNER, 'BAD_OWNER');
    assert(config.pool == f.pool.contract_address, 'BAD_POOL');
    assert(config.token == f.token.contract_address, 'BAD_TOKEN');
    assert(config.supplier_key == f.key.public_key, 'BAD_KEY');
    assert(config.amount == 100, 'BAD_AMOUNT');
    assert(config.claim_before == 2000, 'BAD_DEADLINE');
    fund(f);
    let after = f.probe.configuration();
    assert(after.amount == config.amount, 'AMOUNT_CHANGED');
    assert(after.supplier_key == config.supplier_key, 'KEY_CHANGED');
    assert(after.claim_before == config.claim_before, 'DEADLINE_CHANGED');
}
