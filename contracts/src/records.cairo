use starknet::ContractAddress;

pub const RESERVATION_NONE: u8 = 0;
pub const RESERVATION_OPEN: u8 = 1;
pub const RESERVATION_CLAIMED: u8 = 2;
pub const RESERVATION_EXPIRED: u8 = 3;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Mandate {
    pub owner: ContractAddress,
    pub root: felt252,
    pub operator_key: felt252,
    pub token: ContractAddress,
    pub expires_at: u64,
    pub revoked: bool,
    pub funded: u128,
    pub reserved: u128,
    pub paid: u128,
    pub reclaimed: u128,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Reservation {
    pub mandate_id: felt252,
    pub permission_id: u32,
    pub leaf_hash: felt252,
    pub supplier_key: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub claim_before: u64,
    pub purchase_commitment: felt252,
    pub state: u8,
}

pub fn available(mandate: Mandate) -> u128 {
    let committed = mandate.reserved + mandate.paid + mandate.reclaimed;
    assert(mandate.funded >= committed, 'VOW_ACCOUNTING_BROKEN');
    mandate.funded - committed
}
