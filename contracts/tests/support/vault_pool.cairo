use starknet::ContractAddress;

#[starknet::interface]
pub trait IVaultPool<TState> {
    fn collect(
        ref self: TState,
        vault: ContractAddress,
        reservation_id: felt252,
        note: felt252,
        deadline: u64,
        r: felt252,
        s: felt252,
    );
    fn credited(self: @TState, note: felt252) -> u128;
}

#[starknet::contract]
pub mod VaultPool {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_contract_address};
    use vow_collection_probe::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait, IVowVaultDispatcher, IVowVaultDispatcherTrait,
    };
    use super::IVaultPool;

    #[storage]
    struct Storage {
        credits: Map<felt252, u128>,
    }

    #[abi(embed_v0)]
    impl PoolImpl of IVaultPool<ContractState> {
        fn collect(
            ref self: ContractState,
            vault: ContractAddress,
            reservation_id: felt252,
            note: felt252,
            deadline: u64,
            r: felt252,
            s: felt252,
        ) {
            let result = IVowVaultDispatcher { contract_address: vault }
                .privacy_invoke('CLAIM', reservation_id, note, deadline, r, s);
            assert(result.len() == 1, 'BAD_OUTPUT_COUNT');
            let deposit = *result.at(0);
            assert(deposit.note_id == note, 'BAD_NOTE');
            assert(self.credits.read(note) == 0, 'NOTE_ALREADY_USED');
            let token = IERC20Dispatcher { contract_address: deposit.token };
            assert(
                token.transfer_from(vault, get_contract_address(), deposit.amount.into()),
                'POOL_PULL_FAILED',
            );
            assert(token.allowance(vault, get_contract_address()) == 0, 'POOL_ALLOWANCE_REMAINS');
            self.credits.write(note, deposit.amount);
        }

        fn credited(self: @ContractState, note: felt252) -> u128 {
            self.credits.read(note)
        }
    }
}
