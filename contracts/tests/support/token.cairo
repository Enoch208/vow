use starknet::ContractAddress;

#[starknet::interface]
pub trait ITestToken<TState> {
    fn mint(ref self: TState, owner: ContractAddress, amount: u256);
    fn mode(ref self: TState, value: u8);
}

#[starknet::contract]
pub mod TestToken {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use vow_collection_probe::interfaces::IERC20;
    use super::ITestToken;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        mode: u8,
    }

    #[abi(embed_v0)]
    impl TokenImpl of IERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            if self.mode.read() == 3 {
                return false;
            }
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            if self.mode.read() == 4 {
                return false;
            }
            self.move_balance(get_caller_address(), recipient, amount);
            true
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            if self.mode.read() == 2 {
                return false;
            }
            let slot = (sender, get_caller_address());
            self.allowances.write(slot, self.allowances.read(slot) - amount);
            self.move_balance(sender, recipient, amount);
            true
        }
    }

    #[abi(embed_v0)]
    impl ControlImpl of ITestToken<ContractState> {
        fn mint(ref self: ContractState, owner: ContractAddress, amount: u256) {
            self.balances.write(owner, self.balances.read(owner) + amount);
        }
        fn mode(ref self: ContractState, value: u8) {
            self.mode.write(value);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn move_balance(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            self.balances.write(sender, self.balances.read(sender) - amount);
            let received = if self.mode.read() == 1 {
                amount - 1
            } else {
                amount
            };
            self.balances.write(recipient, self.balances.read(recipient) + received);
        }
    }
}
