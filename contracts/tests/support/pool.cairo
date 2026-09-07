use starknet::ContractAddress;

#[starknet::interface]
pub trait ITestPool<TState> {
    fn collect(
        ref self: TState,
        probe: ContractAddress,
        note: felt252,
        deadline: u64,
        r: felt252,
        s: felt252,
    );
    fn credited(self: @TState, note: felt252) -> u128;
}

#[starknet::contract]
pub mod TestPool {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_contract_address};
    use vow_collection_probe::interfaces::{
        ICollectionProbeDispatcher, ICollectionProbeDispatcherTrait, IERC20Dispatcher,
        IERC20DispatcherTrait,
    };
    use super::ITestPool;

    #[storage]
    struct Storage {
        credits: Map<felt252, u128>,
    }

    #[abi(embed_v0)]
    impl PoolImpl of ITestPool<ContractState> {
        fn collect(
            ref self: ContractState,
            probe: ContractAddress,
            note: felt252,
            deadline: u64,
            r: felt252,
            s: felt252,
        ) {
            let result = ICollectionProbeDispatcher { contract_address: probe }
                .privacy_invoke('CLAIM', 1, note, deadline, r, s);
            assert(result.len() == 1, 'BAD_OUTPUT_COUNT');
            let deposit = *result.at(0);
            assert(deposit.note_id == note, 'BAD_NOTE');
            assert(self.credits.read(note) == 0, 'NOTE_ALREADY_USED');
            let token = IERC20Dispatcher { contract_address: deposit.token };
            assert(
                token.transfer_from(probe, get_contract_address(), deposit.amount.into()),
                'POOL_PULL_FAILED',
            );
            assert(token.allowance(probe, get_contract_address()) == 0, 'POOL_ALLOWANCE_REMAINS');
            self.credits.write(note, deposit.amount);
        }
        fn credited(self: @ContractState, note: felt252) -> u128 {
            self.credits.read(note)
        }
    }
}
