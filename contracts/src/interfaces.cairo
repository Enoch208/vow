use crate::permissions::PermissionLeaf;
use crate::records::{Mandate, Reservation};
use crate::reserve::ReserveAuthorization;
use starknet::ContractAddress;

#[derive(Copy, Drop, Serde)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait IERC20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn allowance(self: @TState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[derive(Copy, Drop, Serde)]
pub struct ProbeConfiguration {
    pub owner: ContractAddress,
    pub pool: ContractAddress,
    pub token: ContractAddress,
    pub supplier_key: felt252,
    pub amount: u128,
    pub claim_before: u64,
}

#[starknet::interface]
pub trait ICollectionProbe<TState> {
    fn fund(ref self: TState);
    fn privacy_invoke(
        ref self: TState,
        operation: felt252,
        reservation_id: felt252,
        output_note_id: felt252,
        signature_deadline: u64,
        signature_r: felt252,
        signature_s: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn reclaim_expired(ref self: TState);
    fn state(self: @TState) -> u8;
    fn configuration(self: @TState) -> ProbeConfiguration;
    fn claim_digest(self: @TState, output_note_id: felt252, signature_deadline: u64) -> felt252;
}

#[derive(Copy, Drop, Serde)]
pub struct MandateTerms {
    pub owner: ContractAddress,
    pub root: felt252,
    pub operator_key: felt252,
    pub token: ContractAddress,
    pub expires_at: u64,
}

#[starknet::interface]
pub trait IVowVault<TState> {
    fn create_mandate(ref self: TState, terms: MandateTerms) -> felt252;
    fn fund_mandate(ref self: TState, mandate_id: felt252, amount: u128);
    fn reserve(
        ref self: TState,
        authorization: ReserveAuthorization,
        leaf: PermissionLeaf,
        proof: Array<felt252>,
        signature_r: felt252,
        signature_s: felt252,
    ) -> felt252;
    fn expire_reservation(ref self: TState, reservation_id: felt252);
    fn revoke_mandate(ref self: TState, mandate_id: felt252);
    fn reclaim_available(
        ref self: TState, mandate_id: felt252, amount: u128, recipient: ContractAddress,
    );
    fn privacy_invoke(
        ref self: TState,
        operation: felt252,
        reservation_id: felt252,
        output_note_id: felt252,
        signature_deadline: u64,
        signature_r: felt252,
        signature_s: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn mandate(self: @TState, mandate_id: felt252) -> Mandate;
    fn reservation(self: @TState, reservation_id: felt252) -> Reservation;
    fn mandate_available(self: @TState, mandate_id: felt252) -> u128;
    fn permission_consumed(self: @TState, mandate_id: felt252, permission_id: u32) -> bool;
    fn accounted_balance(self: @TState, token: ContractAddress) -> u128;
    fn pool(self: @TState) -> ContractAddress;
    fn claim_digest(
        self: @TState, reservation_id: felt252, output_note_id: felt252, signature_deadline: u64,
    ) -> felt252;
}
