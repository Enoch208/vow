use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

pub const PERMISSION_TREE_DEPTH: u32 = 4;
pub const PERMISSION_SLOTS: u32 = 16;

#[derive(Copy, Drop, Serde)]
pub struct PermissionLeaf {
    pub schema_version: felt252,
    pub chain_id: felt252,
    pub vault_address: ContractAddress,
    pub mandate_id: felt252,
    pub permission_id: u32,
    pub supplier_claim_public_key: felt252,
    pub token: ContractAddress,
    pub maximum_amount: u128,
    pub valid_after: u64,
    pub approve_before: u64,
    pub claim_before: u64,
    pub purchase_commitment: felt252,
    pub salt: felt252,
}

pub fn hash_permission(leaf: PermissionLeaf) -> felt252 {
    poseidon_hash_span(
        array![
            'VOW_PERMISSION_V1', leaf.schema_version, leaf.chain_id, leaf.vault_address.into(),
            leaf.mandate_id, leaf.permission_id.into(), leaf.supplier_claim_public_key,
            leaf.token.into(), leaf.maximum_amount.into(), leaf.valid_after.into(),
            leaf.approve_before.into(), leaf.claim_before.into(), leaf.purchase_commitment,
            leaf.salt,
        ]
            .span(),
    )
}

pub fn hash_node(left: felt252, right: felt252) -> felt252 {
    poseidon_hash_span(array![left, right].span())
}

pub fn root_from_proof(leaf_hash: felt252, permission_id: u32, proof: Span<felt252>) -> felt252 {
    assert(proof.len() == PERMISSION_TREE_DEPTH, 'VOW_BAD_PROOF');
    assert(permission_id < PERMISSION_SLOTS, 'VOW_BAD_PROOF');
    let mut node = leaf_hash;
    let mut index = permission_id;
    let mut position: u32 = 0;
    while position < proof.len() {
        let sibling = *proof.at(position);
        node = if index % 2 == 0 {
            hash_node(node, sibling)
        } else {
            hash_node(sibling, node)
        };
        index = index / 2;
        position += 1;
    }
    node
}
