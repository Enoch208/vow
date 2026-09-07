use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address};
use starknet::syscalls::call_contract_syscall;
use vow_collection_probe::interfaces::IVowVaultDispatcherTrait;
use vow_collection_probe::records::RESERVATION_OPEN;
use crate::vault_support::{MANDATE, OWNER, ROOT, setup};

fn create_mandate_calldata() -> Array<felt252> {
    array![
        0x64,
        0x10a9870e430c351eda1c8801c47ab6f28ef6bfd4228d4c94a76ca5e3c355893,
        0x636891ed7d6a8a4bf0c6c96cf3a1562b03d6fb63909691f9504f2f2b67d43be,
        0xca,
        0xbb8,
    ]
}

fn fund_mandate_calldata() -> Array<felt252> {
    array![0x1, 0x64]
}

fn reserve_calldata() -> Array<felt252> {
    array![
        0x534e5f4d41494e, 0xc9, 0x1,
        0x10a9870e430c351eda1c8801c47ab6f28ef6bfd4228d4c94a76ca5e3c355893, 0x0,
        0x5e3a4b1c5a610d43d66077cddaddf3f076e2c057d3dba85dd8967cdf162debe, 0x28, 0x37, 0x6a4,
        0x1, 0x534e5f4d41494e, 0xc9, 0x1, 0x0,
        0x40e629f569f6687e4859da0f61afaa372449d37d6da97af692dd2f3622b5f3a, 0xca, 0x28, 0x1f4,
        0x708, 0x7d0, 0x309, 0x384,
        0x4,
        0x45e574b2625bdf40ea2cd2f91c2fca2135849b6515c940dd78ca5f638299c79,
        0x15211de2b44c7bb5dce9b9d1c76d2749fa6d11de47606e8db819402c06a9d7e,
        0x5437fe13d42721639cb2a76d07295db7b307d4c7d72e5d15dbf86800dde9f4,
        0x9243736cdc563a1d308a864a0c751de7eae7d30689e82feedc832e24fa84a0,
        0x19872341fe1d7089da85829a83ada93b0a3c65cec52de567ba43251c6467b8e,
        0x3de110be1ecdf8c86309302cf122ff7c1fd0d792c10a6d86f39f0fa9b4176c9,
    ]
}

#[test]
fn t_001_typescript_calldata_is_accepted_by_the_deployed_entrypoints() {
    let f = setup();
    let vault = f.vault.contract_address;
    start_cheat_caller_address(vault, OWNER);

    let created = call_contract_syscall(
        vault, selector!("create_mandate"), create_mandate_calldata().span(),
    )
        .unwrap();
    assert(created.len() == 1, 'BAD_MANDATE_RETURN');
    assert(*created.at(0) == MANDATE, 'BAD_MANDATE_ID');

    let mandate = f.vault.mandate(MANDATE);
    assert(mandate.owner == OWNER, 'OWNER_MISDECODED');
    assert(mandate.root == ROOT, 'ROOT_MISDECODED');
    assert(mandate.operator_key == f.operator.public_key, 'OPERATOR_KEY_MISDECODED');
    assert(mandate.token == f.token.contract_address, 'TOKEN_MISDECODED');
    assert(mandate.expires_at == 3000, 'EXPIRY_MISDECODED');

    call_contract_syscall(vault, selector!("fund_mandate"), fund_mandate_calldata().span())
        .unwrap();
    assert(f.vault.mandate_available(MANDATE) == 100, 'FUNDING_MISDECODED');
    stop_cheat_caller_address(vault);

    let reserved = call_contract_syscall(vault, selector!("reserve"), reserve_calldata().span())
        .unwrap();
    assert(reserved.len() == 1, 'BAD_RESERVE_RETURN');
    let reservation_id = *reserved.at(0);
    assert(
        reservation_id == 0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2b,
        'RESERVATION_ID_MISMATCH',
    );

    let reservation = f.vault.reservation(reservation_id);
    assert(reservation.state == RESERVATION_OPEN, 'RESERVATION_NOT_OPEN');
    assert(reservation.amount == 40, 'AMOUNT_MISDECODED');
    assert(reservation.permission_id == 0, 'PERMISSION_MISDECODED');
    assert(reservation.supplier_key == f.supplier.public_key, 'SUPPLIER_KEY_MISDECODED');
    assert(reservation.claim_before == 2000, 'CLAIM_BEFORE_MISDECODED');
    assert(f.vault.mandate_available(MANDATE) == 60, 'ACCOUNTING_MISDECODED');
    assert(f.vault.permission_consumed(MANDATE, 0), 'PERMISSION_NOT_CONSUMED');
}

#[test]
#[feature("safe_dispatcher")]
fn t_005_truncated_or_extended_typescript_calldata_is_rejected() {
    let f = setup();
    let vault = f.vault.contract_address;
    start_cheat_caller_address(vault, OWNER);
    call_contract_syscall(vault, selector!("create_mandate"), create_mandate_calldata().span())
        .unwrap();
    call_contract_syscall(vault, selector!("fund_mandate"), fund_mandate_calldata().span())
        .unwrap();
    stop_cheat_caller_address(vault);

    let full = reserve_calldata();
    let mut truncated = array![];
    let mut index: u32 = 0;
    while index < full.len() - 1 {
        truncated.append(*full.at(index));
        index += 1;
    }
    assert(
        call_contract_syscall(vault, selector!("reserve"), truncated.span()).is_err(),
        'TRUNCATED_ACCEPTED',
    );

    let mut extended = reserve_calldata();
    extended.append(0x1);
    assert(
        call_contract_syscall(vault, selector!("reserve"), extended.span()).is_err(),
        'EXTENDED_ACCEPTED',
    );
    assert(!f.vault.permission_consumed(MANDATE, 0), 'PERMISSION_BURNED');
}
