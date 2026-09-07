#[starknet::contract]
pub mod CollectionProbe {
    use core::ec::{EcPointTrait, stark_curve};
    use core::ecdsa::check_ecdsa_signature;
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address, get_tx_info,
    };
    use crate::claims::{ClaimAuthorization, hash_claim};
    use crate::interfaces::{
        ICollectionProbe, IERC20Dispatcher, IERC20DispatcherTrait, OpenNoteDeposit, ProbeConfiguration,
    };

    #[storage]
    struct Storage {
        owner: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
        supplier_key: felt252,
        amount: u128,
        claim_before: u64,
        state: u8,
        entered: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Funded: Funded,
        Collected: Collected,
        Reclaimed: Reclaimed,
    }

    #[derive(Drop, starknet::Event)]
    struct Funded {
        amount: u128,
    }
    #[derive(Drop, starknet::Event)]
    struct Collected {
        note_id: felt252,
        amount: u128,
    }
    #[derive(Drop, starknet::Event)]
    struct Reclaimed {
        amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        pool: ContractAddress,
        token: ContractAddress,
        supplier_key: felt252,
        amount: u128,
        claim_before: u64,
    ) {
        assert(owner.is_non_zero(), 'VOW_BAD_OWNER');
        assert(pool.is_non_zero(), 'VOW_BAD_POOL');
        assert(token.is_non_zero(), 'VOW_TOKEN_MISMATCH');
        assert(EcPointTrait::new_nz_from_x(supplier_key).is_some(), 'VOW_BAD_SUPPLIER_KEY');
        assert(amount > 0, 'VOW_BAD_AMOUNT');
        assert(claim_before > get_block_timestamp(), 'VOW_CLAIM_EXPIRED');
        self.owner.write(owner);
        self.pool.write(pool);
        self.token.write(token);
        self.supplier_key.write(supplier_key);
        self.amount.write(amount);
        self.claim_before.write(claim_before);
    }

    #[abi(embed_v0)]
    impl CollectionImpl of ICollectionProbe<ContractState> {
        fn fund(ref self: ContractState) {
            self.enter();
            assert(get_caller_address() == self.owner.read(), 'VOW_BAD_OWNER');
            assert(self.state.read() == 0, 'VOW_ALREADY_FUNDED');
            assert(get_block_timestamp() < self.claim_before.read(), 'VOW_CLAIM_EXPIRED');
            let token = self.erc20();
            let here = get_contract_address();
            let before = token.balance_of(here);
            let amount = self.amount.read();
            self.state.write(1);
            assert(
                token.transfer_from(self.owner.read(), here, amount.into()), 'VOW_TRANSFER_FAILED',
            );
            assert(token.balance_of(here) == before + amount.into(), 'VOW_FUNDING_MISMATCH');
            self.emit(Funded { amount });
            self.entered.write(false);
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: felt252,
            reservation_id: felt252,
            output_note_id: felt252,
            signature_deadline: u64,
            signature_r: felt252,
            signature_s: felt252,
        ) -> Span<OpenNoteDeposit> {
            self.enter();
            assert(get_caller_address() == self.pool.read(), 'VOW_BAD_POOL');
            assert(operation == 'CLAIM', 'VOW_BAD_OPERATION');
            assert(reservation_id == 1, 'VOW_BAD_RESERVATION');
            assert(self.state.read() == 1, 'VOW_RESERVATION_NOT_OPEN');
            assert(output_note_id != 0, 'VOW_NOTE_MISMATCH');
            let now = get_block_timestamp();
            assert(now < self.claim_before.read(), 'VOW_CLAIM_EXPIRED');
            assert(now < signature_deadline, 'VOW_SIGNATURE_EXPIRED');
            assert(signature_deadline <= self.claim_before.read(), 'VOW_DEADLINE_EXTENSION');
            let r: u256 = signature_r.into();
            let s: u256 = signature_s.into();
            let order: u256 = stark_curve::ORDER.into();
            assert(
                r > 0 && r < 0x800000000000000000000000000000000000000000000000000000000000000,
                'VOW_BAD_SUPPLIER_SIG',
            );
            assert(s > 0 && s < order, 'VOW_BAD_SUPPLIER_SIG');
            let digest = self.claim_digest(output_note_id, signature_deadline);
            assert(
                check_ecdsa_signature(digest, self.supplier_key.read(), signature_r, signature_s),
                'VOW_BAD_SUPPLIER_SIG',
            );
            let token = self.erc20();
            assert(
                token.allowance(get_contract_address(), self.pool.read()) == 0,
                'VOW_STALE_ALLOWANCE',
            );
            let amount = self.amount.read();
            self.state.write(2);
            assert(token.approve(self.pool.read(), amount.into()), 'VOW_APPROVE_FAILED');
            self.emit(Collected { note_id: output_note_id, amount });
            self.entered.write(false);
            array![OpenNoteDeposit { note_id: output_note_id, token: self.token.read(), amount }]
                .span()
        }

        fn reclaim_expired(ref self: ContractState) {
            self.enter();
            assert(get_caller_address() == self.owner.read(), 'VOW_BAD_OWNER');
            assert(self.state.read() == 1, 'VOW_RESERVATION_NOT_OPEN');
            assert(get_block_timestamp() >= self.claim_before.read(), 'VOW_TOO_EARLY');
            let amount = self.amount.read();
            self.state.write(3);
            assert(self.erc20().transfer(self.owner.read(), amount.into()), 'VOW_TRANSFER_FAILED');
            self.emit(Reclaimed { amount });
            self.entered.write(false);
        }

        fn configuration(self: @ContractState) -> ProbeConfiguration {
            ProbeConfiguration {
                owner: self.owner.read(), pool: self.pool.read(), token: self.token.read(),
                supplier_key: self.supplier_key.read(), amount: self.amount.read(),
                claim_before: self.claim_before.read(),
            }
        }

        fn state(self: @ContractState) -> u8 {
            self.state.read()
        }

        fn claim_digest(
            self: @ContractState, output_note_id: felt252, signature_deadline: u64,
        ) -> felt252 {
            hash_claim(
                ClaimAuthorization {
                    chain_id: get_tx_info().unbox().chain_id,
                    vault_address: get_contract_address(),
                    mandate_id: 1,
                    reservation_id: 1,
                    token: self.token.read(),
                    amount: self.amount.read(),
                    output_note_id,
                    signature_deadline,
                },
            )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn enter(ref self: ContractState) {
            assert(!self.entered.read(), 'VOW_REENTRANT');
            self.entered.write(true);
        }
        fn erc20(self: @ContractState) -> IERC20Dispatcher {
            IERC20Dispatcher { contract_address: self.token.read() }
        }
    }
}
