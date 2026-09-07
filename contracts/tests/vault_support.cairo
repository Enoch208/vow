use snforge_std::signature::stark_curve::{
    StarkCurveKeyPair, StarkCurveKeyPairImpl, StarkCurveSignerImpl,
};
use snforge_std::signature::{KeyPairTrait, SignerTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, start_cheat_chain_id, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use vow_collection_probe::interfaces::{
    IERC20Dispatcher, IERC20DispatcherTrait, IVowVaultDispatcher, IVowVaultDispatcherTrait,
    IVowVaultSafeDispatcher, MandateTerms,
};
use vow_collection_probe::permissions::PermissionLeaf;
use vow_collection_probe::reserve::{ReserveAuthorization, hash_reserve};
use crate::support::token::{ITestTokenDispatcher, ITestTokenDispatcherTrait};
use crate::support::vault_pool::{IVaultPoolDispatcher, IVaultPoolSafeDispatcher};

pub const OWNER: ContractAddress = 100.try_into().unwrap();
pub const OUTSIDER: ContractAddress = 999.try_into().unwrap();
pub const VAULT_ADDRESS: ContractAddress = 201.try_into().unwrap();
pub const TOKEN_ADDRESS: ContractAddress = 202.try_into().unwrap();
pub const CHAIN: felt252 = 'SN_MAIN';
pub const MANDATE: felt252 = 1;
pub const ROOT: felt252 = 0x10a9870e430c351eda1c8801c47ab6f28ef6bfd4228d4c94a76ca5e3c355893;
pub const EXPIRES_AT: u64 = 3000;
pub const NOW: u64 = 1000;

#[derive(Copy, Drop)]
pub struct Fixture {
    pub vault: IVowVaultDispatcher,
    pub token: IERC20Dispatcher,
    pub token_control: ITestTokenDispatcher,
    pub pool: IVaultPoolDispatcher,
    pub operator: StarkCurveKeyPair,
    pub supplier: StarkCurveKeyPair,
}

pub fn setup() -> Fixture {
    let token_class = declare("TestToken").unwrap().contract_class();
    let (token_address, _) = token_class.deploy_at(@array![], TOKEN_ADDRESS).unwrap();
    let (pool_address, _) = declare("VaultPool")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let vault_class = declare("VowVault").unwrap().contract_class();
    let (vault_address, _) = vault_class
        .deploy_at(@array![pool_address.into()], VAULT_ADDRESS)
        .unwrap();
    start_cheat_block_timestamp(vault_address, NOW);
    start_cheat_chain_id(vault_address, CHAIN);
    let token_control = ITestTokenDispatcher { contract_address: token_address };
    token_control.mint(OWNER, 1000);
    start_cheat_caller_address(token_address, OWNER);
    IERC20Dispatcher { contract_address: token_address }.approve(vault_address, 1000);
    stop_cheat_caller_address(token_address);
    Fixture {
        vault: IVowVaultDispatcher { contract_address: vault_address },
        token: IERC20Dispatcher { contract_address: token_address },
        token_control,
        pool: IVaultPoolDispatcher { contract_address: pool_address },
        operator: KeyPairTrait::from_secret_key(0xabcdef),
        supplier: KeyPairTrait::from_secret_key(0x123456),
    }
}

pub fn create_mandate(f: Fixture) -> felt252 {
    start_cheat_caller_address(f.vault.contract_address, OWNER);
    let mandate_id = f
        .vault
        .create_mandate(
            MandateTerms {
                owner: OWNER, root: ROOT, operator_key: f.operator.public_key,
                token: TOKEN_ADDRESS, expires_at: EXPIRES_AT,
            },
        );
    stop_cheat_caller_address(f.vault.contract_address);
    mandate_id
}

pub fn fund(f: Fixture, mandate_id: felt252, amount: u128) {
    start_cheat_caller_address(f.vault.contract_address, OWNER);
    f.vault.fund_mandate(mandate_id, amount);
    stop_cheat_caller_address(f.vault.contract_address);
}

pub fn permission(permission_id: u32, maximum_amount: u128, supplier_key: felt252) -> PermissionLeaf {
    PermissionLeaf {
        schema_version: 1, chain_id: CHAIN, vault_address: VAULT_ADDRESS, mandate_id: MANDATE,
        permission_id, supplier_claim_public_key: supplier_key, token: TOKEN_ADDRESS,
        maximum_amount, valid_after: 500, approve_before: 1800, claim_before: 2000,
        purchase_commitment: 777, salt: 900 + permission_id.into(),
    }
}

pub fn proof(permission_id: u32) -> Array<felt252> {
    let tail = array![
        0x5437fe13d42721639cb2a76d07295db7b307d4c7d72e5d15dbf86800dde9f4,
        0x9243736cdc563a1d308a864a0c751de7eae7d30689e82feedc832e24fa84a0,
    ];
    let head = if permission_id == 0 {
        array![
            0x45e574b2625bdf40ea2cd2f91c2fca2135849b6515c940dd78ca5f638299c79,
            0x15211de2b44c7bb5dce9b9d1c76d2749fa6d11de47606e8db819402c06a9d7e,
        ]
    } else if permission_id == 1 {
        array![
            0x5e3a4b1c5a610d43d66077cddaddf3f076e2c057d3dba85dd8967cdf162debe,
            0x15211de2b44c7bb5dce9b9d1c76d2749fa6d11de47606e8db819402c06a9d7e,
        ]
    } else {
        array![
            0xfdebf299ca616bf205c3999142856c87d4c2ffd3fc3f063bbe438ae74be90a,
            0x4b4930eb0194dc4ae7a6c2450d98f49f4f8c0df2de5cce61cde2bdadd57a9a7,
        ]
    };
    let mut result = head;
    result.append(*tail.at(0));
    result.append(*tail.at(1));
    result
}

pub fn authorization(
    leaf: PermissionLeaf, leaf_hash: felt252, requested_amount: u128, request_id: felt252,
) -> ReserveAuthorization {
    ReserveAuthorization {
        chain_id: CHAIN, vault_address: VAULT_ADDRESS, mandate_id: MANDATE, immutable_root: ROOT,
        permission_id: leaf.permission_id, leaf_hash, requested_amount, request_id,
        request_deadline: 1700,
    }
}

pub fn operator_signature(f: Fixture, auth: ReserveAuthorization) -> (felt252, felt252) {
    f.operator.sign(hash_reserve(auth)).unwrap()
}

pub fn supplier_signature(
    f: Fixture, reservation_id: felt252, note: felt252, deadline: u64,
) -> (felt252, felt252) {
    f.supplier.sign(f.vault.claim_digest(reservation_id, note, deadline)).unwrap()
}

pub fn safe_vault(f: Fixture) -> IVowVaultSafeDispatcher {
    IVowVaultSafeDispatcher { contract_address: f.vault.contract_address }
}

pub fn safe_pool(f: Fixture) -> IVaultPoolSafeDispatcher {
    IVaultPoolSafeDispatcher { contract_address: f.pool.contract_address }
}

pub fn impostor_signature(f: Fixture, auth: ReserveAuthorization) -> (felt252, felt252) {
    f.supplier.sign(hash_reserve(auth)).unwrap()
}
