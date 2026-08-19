use jwt::JWT;
use keccak256::keccak256;

// Must track contracts/src/OidcRecoveryGuardian.sol's IDENTITY_CHANGE_DELAY-adjacent constants
// (PUBKEY_HASH_INDEX=0, IDENTITY_INDEX=1, NONCE_BINDING_INDEX=2, PUBLIC_INPUTS_LENGTH=3) and
// contracts/src/libraries/FieldElement.sol's 253-bit truncation convention. main's three `pub`
// Field parameters are, in declaration order, exactly the publicInputs array the contract reads
// -- nothing else in this signature is public, so the compiled circuit's public input count is
// always 3, matching OidcRecoveryGuardian's strict length check.

// Real Google/Microsoft/Apple id_token headerb64.payloadb64 comfortably fits under 1536 bytes.
global MAX_DATA_LENGTH: u32 = 1536;
global MAX_EMAIL_LENGTH: u32 = 128;
global MAX_SUB_LENGTH: u32 = 64;
global MAX_ISS_LENGTH: u32 = 64;
// Contract-side nonceBinding is a bytes32 field element; the relying party sets the OAuth
// `nonce` param (and thus the JWT's "nonce" claim) to its lowercase, zero-padded, 64-char hex
// encoding (no "0x" prefix) so the claim is a plain JSON string the circuit can assert against.
global NONCE_CLAIM_LENGTH: u32 = 64;

global FIELD_MASK_BYTE0: u8 = 0x1f; // clears the top 3 bits of a 256-bit big-endian value

fn mask_to_field(digest: [u8; 32]) -> Field {
    let mut masked = digest;
    masked[0] = masked[0] & FIELD_MASK_BYTE0;
    let mut acc: Field = 0;
    for i in 0..32 {
        acc = acc * 256 + masked[i] as Field;
    }
    acc
}

fn hex_char(nibble: u8) -> u8 {
    if nibble < 10 {
        48 + nibble // '0'..'9'
    } else {
        87 + nibble // 'a'..'f'
    }
}

// Lowercase, zero-padded, 64-char hex encoding of a Field already known to fit in 253 bits.
fn field_to_hex64(value: Field) -> [u8; NONCE_CLAIM_LENGTH] {
    let bytes: [u8; 32] = value.to_be_bytes();
    let mut out: [u8; NONCE_CLAIM_LENGTH] = [0; NONCE_CLAIM_LENGTH];
    for i in 0..32 {
        out[2 * i] = hex_char(bytes[i] >> 4);
        out[2 * i + 1] = hex_char(bytes[i] & 0x0f);
    }
    out
}

// Reconstructs the big-endian byte encoding of the RSA-2048 modulus from noir-bignum's 18-limb
// representation (17 little-endian limbs of 120 bits / 15 bytes each, plus one 8-bit / 1-byte
// top limb) -- the same bytes the keeper (contracts/script/keeper.mjs) hashes off the JWK's
// base64url "n" field. This is what ties pubkeyHash to the exact key actually used to verify
// the signature, rather than trusting a caller-supplied value.
fn modulus_limbs_to_be_bytes(limbs: [u128; 18]) -> [u8; 256] {
    let mut out: [u8; 256] = [0; 256];
    out[0] = limbs[17] as u8;
    for i in 0..17 {
        let limb_bytes: [u8; 15] = (limbs[i] as Field).to_be_bytes();
        let base = 1 + (16 - i) * 15;
        for j in 0..15 {
            out[base + j] = limb_bytes[j];
        }
    }
    out
}

fn main(
    data: BoundedVec<u8, MAX_DATA_LENGTH>,
    base64_decode_offset: u32,
    pubkey_modulus_limbs: [u128; 18],
    redc_params_limbs: [u128; 18],
    signature_limbs: [u128; 18],
    pubkey_hash: pub Field,
    identity: pub Field,
    nonce_binding: pub Field,
) {
    let jwt = JWT::init(
        data,
        base64_decode_offset,
        pubkey_modulus_limbs,
        redc_params_limbs,
        signature_limbs,
    );

    jwt.verify();

    // publicInputs[NONCE_BINDING_INDEX]: the circuit doesn't recompute
    // keccak(wallet, promoteKey, nonce, chainid) itself (it has no way to see those values) --
    // it proves that THIS verified, currently-live-keyed token's "nonce" claim equals the
    // caller-supplied binding, which OidcRecoveryGuardian independently recomputes on-chain
    // before ever calling the verifier. That's what stops a captured proof from being replayed
    // against a different wallet/promoteKey/nonce/chain.
    let nonce_claim_hex: [u8; NONCE_CLAIM_LENGTH] = field_to_hex64(nonce_binding);
    jwt.assert_claim_string(
        "nonce".as_bytes(),
        BoundedVec::<u8, NONCE_CLAIM_LENGTH>::from_array(nonce_claim_hex),
    );

    // publicInputs[PUBKEY_HASH_INDEX]: proves the modulus actually used above (not some other
    // value) is the one whose hash the caller claims -- OidcRecoveryGuardian checks this equals
    // the keyHash argument, i.e. the record KeyRegistry.isKeyUsable already vouched for.
    let modulus_bytes: [u8; 256] = modulus_limbs_to_be_bytes(pubkey_modulus_limbs);
    let modulus_digest: [u8; 32] = keccak256(modulus_bytes, 256);
    assert(mask_to_field(modulus_digest) == pubkey_hash, "pubkeyHash does not match verified key");

    // publicInputs[IDENTITY_INDEX]: identityCommitment = toField(keccak256(emailHash, sub,
    // issuer)), per .superpowers/specs/2026-08-18-keyregistry-spec.md's "Identity commitment"
    // section -- sub defeats a recycled-workspace-address attack that an email-only commitment
    // would be vulnerable to. emailHash = keccak256(email claim bytes). The outer preimage is a
    // FIXED-length layout, always hashed in full (no variable message_size here): emailHash(32)
    // || big-endian u16 sub length || sub bytes zero-padded to MAX_SUB_LENGTH || big-endian u16
    // issuer length || issuer bytes zero-padded to MAX_ISS_LENGTH. The length prefixes make real
    // content unambiguous from zero padding without needing a variable-length hash, so this can't
    // fall into the same offset-vs-length_prefix trap a tightly-packed variable-length preimage
    // would. This exact layout must be matched by whatever off-chain client computes the
    // commitment passed to OidcRecoveryGuardian.setRecoveryIdentity.
    let email: BoundedVec<u8, MAX_EMAIL_LENGTH> = jwt.get_claim_string("email".as_bytes());
    let sub: BoundedVec<u8, MAX_SUB_LENGTH> = jwt.get_claim_string("sub".as_bytes());
    let iss: BoundedVec<u8, MAX_ISS_LENGTH> = jwt.get_claim_string("iss".as_bytes());

    let email_digest: [u8; 32] = keccak256(email.storage(), email.len() as u32);

    let mut preimage: [u8; 32 + 2 + MAX_SUB_LENGTH + 2 + MAX_ISS_LENGTH] =
        [0; 32 + 2 + MAX_SUB_LENGTH + 2 + MAX_ISS_LENGTH];
    for i in 0..32 {
        preimage[i] = email_digest[i];
    }
    let sub_len = sub.len();
    preimage[32] = (sub_len >> 8) as u8;
    preimage[33] = sub_len as u8;
    let sub_storage = sub.storage();
    for i in 0..MAX_SUB_LENGTH {
        preimage[34 + i] = sub_storage[i];
    }
    let iss_len = iss.len();
    let iss_len_offset = 34 + MAX_SUB_LENGTH;
    preimage[iss_len_offset] = (iss_len >> 8) as u8;
    preimage[iss_len_offset + 1] = iss_len as u8;
    let iss_storage = iss.storage();
    for i in 0..MAX_ISS_LENGTH {
        preimage[iss_len_offset + 2 + i] = iss_storage[i];
    }

    let identity_digest: [u8; 32] = keccak256(preimage, preimage.len());
    assert(mask_to_field(identity_digest) == identity, "identity does not match token claims");
}
