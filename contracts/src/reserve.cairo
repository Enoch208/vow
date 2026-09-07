use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

#[derive(Copy, Drop, Serde)]
pub struct ReserveAuthorization {
    pub chain_id: felt252,
    pub vault_address: ContractAddress,
    pub mandate_id: felt252,
    pub immutable_root: felt252,
    pub permission_id: u32,
    pub leaf_hash: felt252,
    pub requested_amount: u128,
    pub request_id: felt252,
    pub request_deadline: u64,
}

pub fn hash_reserve(authorization: ReserveAuthorization) -> felt252 {
    poseidon_hash_span(
        array![
            'VOW_RESERVE_V1', authorization.chain_id, authorization.vault_address.into(),
            authorization.mandate_id, authorization.immutable_root,
            authorization.permission_id.into(), authorization.leaf_hash,
            authorization.requested_amount.into(), authorization.request_id,
            authorization.request_deadline.into(),
        ]
            .span(),
    )
}
