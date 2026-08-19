// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title FieldElement
/// @notice UltraHonk public inputs are BN254 scalar field elements (< ~2^254), not arbitrary
///         bytes32. A raw keccak256 output is a full 256-bit value and will routinely exceed the
///         field modulus — passed straight through, it either reverts against the real verifier
///         or (worse, if some future path mods it implicitly) silently stops meaning what the
///         circuit and the contract each think it means. Every commitment-style value that
///         crosses the KeyRegistry / OidcRecoveryGuardian / verifier boundary is canonicalized
///         through `toField` before it's stored, compared, or passed as a public input — on both
///         the circuit side (documented here as the contract-side half of that contract) and the
///         contract side (enforced below).
///
///         Choice made here, of the two standard options: 253-bit truncation (mask off the top 3
///         bits) rather than two-limb (hi/lo) splitting. BN254's modulus is just under 2^254, so
///         a 253-bit value is always below it regardless of the exact modulus — no per-value
///         range check needed, just a mask. Collision resistance drops from 256 to 253 bits,
///         which is not a meaningful weakening for this use. Two-limb splitting is the better
///         choice when full 256-bit precision must survive into the circuit (e.g. representing an
///         RSA modulus exactly); it is not needed here, where every value in question is already
///         a commitment/digest that only needs to be equality-checked, never decomposed.
library FieldElement {
    uint256 internal constant FIELD_MASK = (1 << 253) - 1;

    function toField(bytes32 raw) internal pure returns (bytes32) {
        return bytes32(uint256(raw) & FIELD_MASK);
    }

    function isField(bytes32 value) internal pure returns (bool) {
        return uint256(value) <= FIELD_MASK;
    }
}
