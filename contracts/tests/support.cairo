pub mod vault_pool;
pub mod pool;
pub mod token;
use pool::{ITestPoolDispatcher, ITestPoolSafeDispatcher};
use snforge_std::signature::stark_curve::{
    StarkCurveKeyPair, StarkCurveKeyPairImpl, StarkCurveSignerImpl,
};
use snforge_std::signature::{KeyPairTrait, SignerTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, start_cheat_chain_id,
};
use starknet::ContractAddress;
use token::{ITestTokenDispatcher, ITestTokenDispatcherTrait};
use vow_collection_probe::interfaces::{
    ICollectionProbeDispatcher, ICollectionProbeDispatcherTrait, ICollectionProbeSafeDispatcher,
    IERC20Dispatcher, IERC20DispatcherTrait,
};

pub const OWNER: ContractAddress = 100.try_into().unwrap();
pub const CHAIN: felt252 = 'SN_MAIN';

#[derive(Copy, Drop)]
pub struct Fixture {
    pub probe: ICollectionProbeDispatcher,
    pub token: IERC20Dispatcher,
    pub token_control: ITestTokenDispatcher,
    pub pool: ITestPoolDispatcher,
    pub key: StarkCurveKeyPair,
}

pub fn setup() -> Fixture {
    let (token_address, _) = declare("TestToken")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let (pool_address, _) = declare("TestPool")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let key = KeyPairTrait::from_secret_key(0x123456);
    let (probe_address, _) = declare("CollectionProbe")
        .unwrap()
        .contract_class()
        .deploy(
            @array![
                OWNER.into(), pool_address.into(), token_address.into(), key.public_key, 100, 2000,
            ],
        )
        .unwrap();
    start_cheat_block_timestamp(probe_address, 1000);
    start_cheat_chain_id(probe_address, CHAIN);
    start_cheat_caller_address(probe_address, OWNER);
    start_cheat_caller_address(token_address, OWNER);
    let token = IERC20Dispatcher { contract_address: token_address };
    let token_control = ITestTokenDispatcher { contract_address: token_address };
    token_control.mint(OWNER, 1000);
    token.approve(probe_address, 100);
    Fixture {
        probe: ICollectionProbeDispatcher { contract_address: probe_address },
        token,
        token_control,
        pool: ITestPoolDispatcher { contract_address: pool_address },
        key,
    }
}

pub fn fund(f: Fixture) {
    snforge_std::stop_cheat_caller_address(f.token.contract_address);
    f.probe.fund();
    snforge_std::stop_cheat_caller_address(f.probe.contract_address);
}

pub fn signature(f: Fixture, note: felt252, deadline: u64) -> (felt252, felt252) {
    f.key.sign(f.probe.claim_digest(note, deadline)).unwrap()
}

pub fn safe_probe(f: Fixture) -> ICollectionProbeSafeDispatcher {
    ICollectionProbeSafeDispatcher { contract_address: f.probe.contract_address }
}

pub fn safe_pool(f: Fixture) -> ITestPoolSafeDispatcher {
    ITestPoolSafeDispatcher { contract_address: f.pool.contract_address }
}
