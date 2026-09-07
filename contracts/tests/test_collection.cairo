use snforge_std::{start_cheat_block_timestamp, start_cheat_caller_address};
use vow_collection_probe::interfaces::{
    ICollectionProbeDispatcherTrait, ICollectionProbeSafeDispatcherTrait, IERC20DispatcherTrait,
};
use crate::support::pool::{ITestPoolDispatcherTrait, ITestPoolSafeDispatcherTrait};
use crate::support::token::ITestTokenDispatcherTrait;
use crate::support::{OWNER, fund, safe_pool, safe_probe, setup, signature};

#[test]
fn t_013_exact_funding_and_atomic_collection() {
    let f = setup();
    fund(f);
    assert(f.probe.state() == 1, 'NOT_RESERVED');
    assert(f.token.balance_of(f.probe.contract_address) == 100, 'BAD_FUNDING');
    let (r, s) = signature(f, 777, 1900);
    f.pool.collect(f.probe.contract_address, 777, 1900, r, s);
    assert(f.probe.state() == 2, 'NOT_CLAIMED');
    assert(f.pool.credited(777) == 100, 'NOT_CREDITED');
    assert(f.token.balance_of(f.probe.contract_address) == 0, 'RESIDUAL_FUNDS');
    assert(
        f.token.allowance(f.probe.contract_address, f.pool.contract_address) == 0,
        'RESIDUAL_ALLOWANCE',
    );
}

#[test]
#[feature("safe_dispatcher")]
fn t_006_copied_signature_cannot_target_another_note() {
    let f = setup();
    fund(f);
    let (r, s) = signature(f, 777, 1900);
    assert(safe_pool(f).collect(f.probe.contract_address, 778, 1900, r, s).is_err(), 'REDIRECTED');
    assert(f.probe.state() == 1, 'STATE_CHANGED');
    f.pool.collect(f.probe.contract_address, 777, 1900, r, s);
    assert(f.pool.credited(777) == 100, 'ORIGINAL_FAILED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_011_wrong_pool_cannot_collect() {
    let f = setup();
    fund(f);
    let (r, s) = signature(f, 777, 1900);
    assert(safe_probe(f).privacy_invoke('CLAIM', 1, 777, 1900, r, s).is_err(), 'BAD_POOL_ACCEPTED');
    assert(f.probe.state() == 1, 'STATE_CHANGED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_008_collection_has_one_terminal_outcome() {
    let f = setup();
    fund(f);
    let (r, s) = signature(f, 777, 1900);
    f.pool.collect(f.probe.contract_address, 777, 1900, r, s);
    assert(
        safe_pool(f).collect(f.probe.contract_address, 777, 1900, r, s).is_err(), 'REPLAY_ACCEPTED',
    );
    start_cheat_block_timestamp(f.probe.contract_address, 2000);
    start_cheat_caller_address(f.probe.contract_address, OWNER);
    assert(safe_probe(f).reclaim_expired().is_err(), 'DOUBLE_PAYMENT');
}

#[test]
#[feature("safe_dispatcher")]
fn t_007_expiry_boundary_and_owner_recovery() {
    let f = setup();
    fund(f);
    start_cheat_caller_address(f.probe.contract_address, OWNER);
    assert(safe_probe(f).reclaim_expired().is_err(), 'EARLY_RECLAIM');
    start_cheat_block_timestamp(f.probe.contract_address, 2000);
    let (r, s) = signature(f, 777, 2000);
    snforge_std::stop_cheat_caller_address(f.probe.contract_address);
    assert(safe_pool(f).collect(f.probe.contract_address, 777, 2000, r, s).is_err(), 'LATE_CLAIM');
    start_cheat_caller_address(f.probe.contract_address, OWNER);
    f.probe.reclaim_expired();
    assert(f.probe.state() == 3, 'NOT_RECLAIMED');
    assert(f.token.balance_of(OWNER) == 1000, 'BAD_OWNER_BALANCE');
    assert(safe_probe(f).reclaim_expired().is_err(), 'RECLAIM_REPLAY');
}

#[test]
#[feature("safe_dispatcher")]
fn t_013_failed_pull_rolls_back_claim_and_allowance() {
    let f = setup();
    fund(f);
    let (r, s) = signature(f, 777, 1900);
    f.token_control.mode(2);
    assert(
        safe_pool(f).collect(f.probe.contract_address, 777, 1900, r, s).is_err(), 'PULL_SUCCEEDED',
    );
    assert(f.probe.state() == 1, 'CLAIM_NOT_ROLLED_BACK');
    assert(
        f.token.allowance(f.probe.contract_address, f.pool.contract_address) == 0,
        'ALLOWANCE_NOT_ROLLED_BACK',
    );
    assert(f.token.balance_of(f.probe.contract_address) == 100, 'FUNDS_LOST');
    f.token_control.mode(0);
    f.pool.collect(f.probe.contract_address, 777, 1900, r, s);
}

#[test]
#[feature("safe_dispatcher")]
fn t_013_inexact_funding_rolls_back_every_effect() {
    let f = setup();
    f.token_control.mode(1);
    snforge_std::stop_cheat_caller_address(f.token.contract_address);
    assert(safe_probe(f).fund().is_err(), 'FEE_TOKEN_ACCEPTED');
    assert(f.probe.state() == 0, 'STATE_NOT_ROLLED_BACK');
    assert(f.token.balance_of(OWNER) == 1000, 'OWNER_DEBIT_REMAINS');
    assert(f.token.balance_of(f.probe.contract_address) == 0, 'VAULT_CREDIT_REMAINS');
    f.token_control.mode(0);
    f.probe.fund();
}

#[test]
fn t_014_donation_does_not_increase_supplier_entitlement() {
    let f = setup();
    f.token_control.mint(f.probe.contract_address, 500);
    fund(f);
    let (r, s) = signature(f, 777, 1900);
    f.pool.collect(f.probe.contract_address, 777, 1900, r, s);
    assert(f.pool.credited(777) == 100, 'DONATION_SPENT');
    assert(f.token.balance_of(f.probe.contract_address) == 500, 'DONATION_DRAINED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_010_non_owner_cannot_reclaim_expired_funds() {
    let f = setup();
    fund(f);
    start_cheat_block_timestamp(f.probe.contract_address, 2000);
    start_cheat_caller_address(f.probe.contract_address, 999.try_into().unwrap());
    assert(safe_probe(f).reclaim_expired().is_err(), 'UNAUTHORIZED_RECLAIM');
    assert(f.probe.state() == 1, 'STATE_CHANGED');
}
