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
