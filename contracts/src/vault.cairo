#[starknet::contract]
pub mod VowVault {
    use core::ec::{EcPointTrait, stark_curve};
    use core::ecdsa::check_ecdsa_signature;
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address, get_tx_info,
    };
    use crate::claims::{ClaimAuthorization, hash_claim};
    use crate::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait, IVowVault, MandateTerms, OpenNoteDeposit,
    };
    use crate::permissions::{PermissionLeaf, hash_permission, root_from_proof};
    use crate::records::{
        Mandate, RESERVATION_CLAIMED, RESERVATION_EXPIRED, RESERVATION_OPEN, Reservation, available,
    };
    use crate::reserve::{ReserveAuthorization, hash_reserve};

    #[storage]
    struct Storage {
        pool: ContractAddress,
        next_mandate: felt252,
        mandates: Map<felt252, Mandate>,
        reservations: Map<felt252, Reservation>,
        consumed: Map<(felt252, u32), bool>,
        accounted: Map<ContractAddress, u128>,
        entered: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        MandateCreated: MandateCreated,
        MandateFunded: MandateFunded,
        PurchaseReserved: PurchaseReserved,
        ReservationClaimed: ReservationClaimed,
        ReservationExpired: ReservationExpired,
        MandateRevoked: MandateRevoked,
        OwnerReclaimed: OwnerReclaimed,
    }

    #[derive(Drop, starknet::Event)]
    struct MandateCreated {
        #[key]
        mandate_id: felt252,
        owner: ContractAddress,
        root: felt252,
        operator_key: felt252,
        token: ContractAddress,
        expires_at: u64,
    }
    #[derive(Drop, starknet::Event)]
    struct MandateFunded {
        #[key]
        mandate_id: felt252,
        amount: u128,
        funded_total: u128,
    }
    #[derive(Drop, starknet::Event)]
    struct PurchaseReserved {
        #[key]
        reservation_id: felt252,
        #[key]
        mandate_id: felt252,
        permission_id: u32,
        leaf_hash: felt252,
        supplier_key: felt252,
        amount: u128,
        claim_before: u64,
    }
    #[derive(Drop, starknet::Event)]
    struct ReservationClaimed {
        #[key]
        reservation_id: felt252,
        #[key]
        mandate_id: felt252,
        note_id: felt252,
        amount: u128,
    }
    #[derive(Drop, starknet::Event)]
    struct ReservationExpired {
        #[key]
        reservation_id: felt252,
        amount: u128,
    }
    #[derive(Drop, starknet::Event)]
    struct MandateRevoked {
        #[key]
        mandate_id: felt252,
    }
    #[derive(Drop, starknet::Event)]
    struct OwnerReclaimed {
        #[key]
        mandate_id: felt252,
        amount: u128,
        recipient: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), 'VOW_BAD_POOL');
        self.pool.write(pool);
        self.next_mandate.write(1);
    }

    #[abi(embed_v0)]
    impl VaultImpl of IVowVault<ContractState> {
        fn create_mandate(ref self: ContractState, terms: MandateTerms) -> felt252 {
            self.enter();
            assert(terms.owner == get_caller_address(), 'VOW_BAD_OWNER');
            assert(terms.owner.is_non_zero(), 'VOW_BAD_OWNER');
            assert(terms.root != 0, 'VOW_BAD_ROOT');
            assert(terms.token.is_non_zero(), 'VOW_TOKEN_MISMATCH');
            assert(
                EcPointTrait::new_nz_from_x(terms.operator_key).is_some(), 'VOW_BAD_OPERATOR_SIG',
            );
            assert(terms.expires_at > get_block_timestamp(), 'VOW_MANDATE_CLOSED');
            let mandate_id = self.next_mandate.read();
            self.next_mandate.write(mandate_id + 1);
            self
                .mandates
                .write(
                    mandate_id,
                    Mandate {
                        owner: terms.owner, root: terms.root, operator_key: terms.operator_key,
                        token: terms.token, expires_at: terms.expires_at, revoked: false, funded: 0,
                        reserved: 0, paid: 0, reclaimed: 0,
                    },
                );
            self
                .emit(
                    MandateCreated {
                        mandate_id, owner: terms.owner, root: terms.root,
                        operator_key: terms.operator_key, token: terms.token,
                        expires_at: terms.expires_at,
                    },
                );
            self.exit();
            mandate_id
        }

        fn fund_mandate(ref self: ContractState, mandate_id: felt252, amount: u128) {
            self.enter();
            let mut mandate = self.live_mandate(mandate_id);
            assert(get_caller_address() == mandate.owner, 'VOW_BAD_OWNER');
            assert(amount > 0, 'VOW_BAD_AMOUNT');
            let token = IERC20Dispatcher { contract_address: mandate.token };
            let here = get_contract_address();
            let before = token.balance_of(here);
            mandate.funded = mandate.funded + amount;
            self.mandates.write(mandate_id, mandate);
            self.accounted.write(mandate.token, self.accounted.read(mandate.token) + amount);
            assert(token.transfer_from(mandate.owner, here, amount.into()), 'VOW_TRANSFER_FAILED');
            assert(token.balance_of(here) == before + amount.into(), 'VOW_FUNDING_MISMATCH');
            self.emit(MandateFunded { mandate_id, amount, funded_total: mandate.funded });
            self.exit();
        }

        fn reserve(
            ref self: ContractState,
            authorization: ReserveAuthorization,
            leaf: PermissionLeaf,
            proof: Array<felt252>,
            signature_r: felt252,
            signature_s: felt252,
        ) -> felt252 {
            self.enter();
            let mandate_id = authorization.mandate_id;
            let mut mandate = self.live_mandate(mandate_id);
            assert(!mandate.revoked, 'VOW_MANDATE_CLOSED');
            let now = get_block_timestamp();
            assert(now < mandate.expires_at, 'VOW_MANDATE_CLOSED');

            let here = get_contract_address();
            let chain_id = get_tx_info().unbox().chain_id;
            assert(leaf.mandate_id == mandate_id, 'VOW_BAD_PROOF');
            assert(leaf.vault_address == here, 'VOW_BAD_PROOF');
            assert(leaf.chain_id == chain_id, 'VOW_BAD_PROOF');
            assert(leaf.token == mandate.token, 'VOW_TOKEN_MISMATCH');
            assert(leaf.permission_id == authorization.permission_id, 'VOW_BAD_PROOF');
            assert(
                EcPointTrait::new_nz_from_x(leaf.supplier_claim_public_key).is_some(),
                'VOW_BAD_SUPPLIER_SIG',
            );

            let leaf_hash = hash_permission(leaf);
            assert(leaf_hash == authorization.leaf_hash, 'VOW_BAD_PROOF');
            assert(root_from_proof(leaf_hash, leaf.permission_id, proof.span()) == mandate.root,
                'VOW_BAD_PROOF');

            assert(authorization.vault_address == here, 'VOW_BAD_OPERATOR_SIG');
            assert(authorization.chain_id == chain_id, 'VOW_BAD_OPERATOR_SIG');
            assert(authorization.immutable_root == mandate.root, 'VOW_BAD_ROOT');
            assert(authorization.request_id != 0, 'VOW_BAD_OPERATOR_SIG');
            self.check_signature(hash_reserve(authorization), mandate.operator_key, signature_r,
                signature_s, 'VOW_BAD_OPERATOR_SIG');

            assert(!self.consumed.read((mandate_id, leaf.permission_id)), 'VOW_PERMISSION_USED');
            assert(now >= leaf.valid_after, 'VOW_TOO_EARLY');
            assert(now < leaf.approve_before, 'VOW_APPROVAL_EXPIRED');
            assert(now < authorization.request_deadline, 'VOW_APPROVAL_EXPIRED');
            assert(leaf.claim_before <= mandate.expires_at, 'VOW_MANDATE_CLOSED');
            assert(now < leaf.claim_before, 'VOW_CLAIM_EXPIRED');

            let amount = authorization.requested_amount;
            assert(amount > 0, 'VOW_BAD_AMOUNT');
            assert(amount <= leaf.maximum_amount, 'VOW_OVER_CAP');
            assert(amount <= available(mandate), 'VOW_INSUFFICIENT_AVAILABLE');

            self.consumed.write((mandate_id, leaf.permission_id), true);
            mandate.reserved = mandate.reserved + amount;
            self.mandates.write(mandate_id, mandate);

            let reservation_id = poseidon_hash_span(
                array!['VOW_RESERVATION_V1', mandate_id, leaf.permission_id.into()].span(),
            );
            assert(
                self.reservations.read(reservation_id).state == 0, 'VOW_PERMISSION_USED',
            );
            self
                .reservations
                .write(
                    reservation_id,
                    Reservation {
                        mandate_id, permission_id: leaf.permission_id, leaf_hash,
                        supplier_key: leaf.supplier_claim_public_key, token: leaf.token, amount,
                        claim_before: leaf.claim_before,
                        purchase_commitment: leaf.purchase_commitment, state: RESERVATION_OPEN,
                    },
                );
            self
                .emit(
                    PurchaseReserved {
                        reservation_id, mandate_id, permission_id: leaf.permission_id, leaf_hash,
                        supplier_key: leaf.supplier_claim_public_key, amount,
                        claim_before: leaf.claim_before,
                    },
                );
            self.exit();
            reservation_id
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
            let mut reservation = self.reservations.read(reservation_id);
            assert(reservation.state == RESERVATION_OPEN, 'VOW_RESERVATION_NOT_OPEN');
            assert(output_note_id != 0, 'VOW_NOTE_MISMATCH');
            let now = get_block_timestamp();
            assert(now < reservation.claim_before, 'VOW_CLAIM_EXPIRED');
            assert(now < signature_deadline, 'VOW_SIGNATURE_EXPIRED');
            assert(signature_deadline <= reservation.claim_before, 'VOW_DEADLINE_EXTENSION');

            let digest = self.claim_digest(reservation_id, output_note_id, signature_deadline);
            self.check_signature(digest, reservation.supplier_key, signature_r, signature_s,
                'VOW_BAD_SUPPLIER_SIG');

            let token = IERC20Dispatcher { contract_address: reservation.token };
            let pool = self.pool.read();
            assert(token.allowance(get_contract_address(), pool) == 0, 'VOW_STALE_ALLOWANCE');

            let amount = reservation.amount;
            reservation.state = RESERVATION_CLAIMED;
            self.reservations.write(reservation_id, reservation);
            let mut mandate = self.mandates.read(reservation.mandate_id);
            mandate.reserved = mandate.reserved - amount;
            mandate.paid = mandate.paid + amount;
            self.mandates.write(reservation.mandate_id, mandate);
            self
                .accounted
                .write(reservation.token, self.accounted.read(reservation.token) - amount);

            assert(token.approve(pool, amount.into()), 'VOW_APPROVE_FAILED');
            self
                .emit(
                    ReservationClaimed {
                        reservation_id, mandate_id: reservation.mandate_id,
                        note_id: output_note_id, amount,
                    },
                );
            self.exit();
            array![
                OpenNoteDeposit { note_id: output_note_id, token: reservation.token, amount },
            ]
                .span()
        }

        fn expire_reservation(ref self: ContractState, reservation_id: felt252) {
            self.enter();
            let mut reservation = self.reservations.read(reservation_id);
            assert(reservation.state == RESERVATION_OPEN, 'VOW_RESERVATION_NOT_OPEN');
            assert(get_block_timestamp() >= reservation.claim_before, 'VOW_TOO_EARLY');
            let amount = reservation.amount;
            reservation.state = RESERVATION_EXPIRED;
            self.reservations.write(reservation_id, reservation);
            let mut mandate = self.mandates.read(reservation.mandate_id);
            mandate.reserved = mandate.reserved - amount;
            self.mandates.write(reservation.mandate_id, mandate);
            self.emit(ReservationExpired { reservation_id, amount });
            self.exit();
        }

        fn revoke_mandate(ref self: ContractState, mandate_id: felt252) {
            self.enter();
            let mut mandate = self.live_mandate(mandate_id);
            assert(get_caller_address() == mandate.owner, 'VOW_BAD_OWNER');
            assert(!mandate.revoked, 'VOW_MANDATE_CLOSED');
            mandate.revoked = true;
            self.mandates.write(mandate_id, mandate);
            self.emit(MandateRevoked { mandate_id });
            self.exit();
        }

        fn reclaim_available(
            ref self: ContractState, mandate_id: felt252, amount: u128, recipient: ContractAddress,
        ) {
            self.enter();
            let mut mandate = self.live_mandate(mandate_id);
            assert(get_caller_address() == mandate.owner, 'VOW_BAD_OWNER');
            assert(recipient.is_non_zero(), 'VOW_BAD_RECIPIENT');
            assert(amount > 0, 'VOW_BAD_AMOUNT');
            assert(amount <= available(mandate), 'VOW_RECLAIM_RESERVED');
            mandate.reclaimed = mandate.reclaimed + amount;
            self.mandates.write(mandate_id, mandate);
            self.accounted.write(mandate.token, self.accounted.read(mandate.token) - amount);
            let token = IERC20Dispatcher { contract_address: mandate.token };
            assert(token.transfer(recipient, amount.into()), 'VOW_TRANSFER_FAILED');
            self.emit(OwnerReclaimed { mandate_id, amount, recipient });
            self.exit();
        }

        fn mandate(self: @ContractState, mandate_id: felt252) -> Mandate {
            self.mandates.read(mandate_id)
        }

        fn reservation(self: @ContractState, reservation_id: felt252) -> Reservation {
            self.reservations.read(reservation_id)
        }

        fn mandate_available(self: @ContractState, mandate_id: felt252) -> u128 {
            available(self.mandates.read(mandate_id))
        }

        fn permission_consumed(
            self: @ContractState, mandate_id: felt252, permission_id: u32,
        ) -> bool {
            self.consumed.read((mandate_id, permission_id))
        }

        fn accounted_balance(self: @ContractState, token: ContractAddress) -> u128 {
            self.accounted.read(token)
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn claim_digest(
            self: @ContractState,
            reservation_id: felt252,
            output_note_id: felt252,
            signature_deadline: u64,
        ) -> felt252 {
            let reservation = self.reservations.read(reservation_id);
            hash_claim(
                ClaimAuthorization {
                    chain_id: get_tx_info().unbox().chain_id,
                    vault_address: get_contract_address(),
                    mandate_id: reservation.mandate_id, reservation_id, token: reservation.token,
                    amount: reservation.amount, output_note_id, signature_deadline,
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

        fn exit(ref self: ContractState) {
            self.entered.write(false);
        }

        fn live_mandate(self: @ContractState, mandate_id: felt252) -> Mandate {
            let mandate = self.mandates.read(mandate_id);
            assert(mandate.owner.is_non_zero(), 'VOW_MANDATE_CLOSED');
            mandate
        }

        fn check_signature(
            self: @ContractState,
            digest: felt252,
            key: felt252,
            signature_r: felt252,
            signature_s: felt252,
            code: felt252,
        ) {
            let r: u256 = signature_r.into();
            let s: u256 = signature_s.into();
            let order: u256 = stark_curve::ORDER.into();
            assert(
                r > 0 && r < 0x800000000000000000000000000000000000000000000000000000000000000,
                code,
            );
            assert(s > 0 && s < order, code);
            assert(check_ecdsa_signature(digest, key, signature_r, signature_s), code);
        }
    }
}
