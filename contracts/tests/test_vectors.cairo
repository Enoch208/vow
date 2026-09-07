use core::ecdsa::check_ecdsa_signature;
use core::poseidon::poseidon_hash_span;
use vow_collection_probe::claims::{ClaimAuthorization, hash_claim};

#[test]
fn t_001_typescript_claim_vector_matches_cairo() {
    let digest = hash_claim(
        ClaimAuthorization {
            chain_id: 'SN_MAIN',
            vault_address: 101.try_into().unwrap(),
            mandate_id: 1,
            reservation_id: 2,
            token: 102.try_into().unwrap(),
            amount: 1234567,
            output_note_id: 103,
            signature_deadline: 2000,
        },
    );
    assert(
        digest == 0x3d3f2cca1b86dcdd2d5b8fe5c5cb8d37b5972faddd16a5e2b2f8eb87047f0b5,
        'CLAIM_VECTOR_MISMATCH',
    );
    assert(
        check_ecdsa_signature(
            digest,
            0x40e629f569f6687e4859da0f61afaa372449d37d6da97af692dd2f3622b5f3a,
            0x14fa6b06f71a3b778a05890478e172f74a7f6d5c75df8ce519b4f485cb74603,
            0x1e6e612f39c76db07748ac1a14ce0f4b814f877e8db8311839b84ef6e7e8e6a,
        ),
        'TYPESCRIPT_SIGNATURE_REJECTED',
    );
}

#[test]
fn t_001_typescript_reservation_id_vector_matches_cairo() {
    assert(
        poseidon_hash_span(array!['VOW_RESERVATION_V1', 1, 0].span())
            == 0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2b,
        'RESERVATION_VECTOR_MISMATCH',
    );
}
