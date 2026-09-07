use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

#[derive(Copy, Drop, Serde)]
pub struct ClaimAuthorization {
    pub chain_id: felt252,
    pub vault_address: ContractAddress,
    pub mandate_id: felt252,
    pub reservation_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub output_note_id: felt252,
    pub signature_deadline: u64,
}

pub fn hash_claim(claim: ClaimAuthorization) -> felt252 {
    poseidon_hash_span(
        array![
            'VOW_CLAIM_V1', claim.chain_id, claim.vault_address.into(), claim.mandate_id,
            claim.reservation_id, claim.token.into(), claim.amount.into(), claim.output_note_id,
            claim.signature_deadline.into(),
        ]
            .span(),
    )
}
