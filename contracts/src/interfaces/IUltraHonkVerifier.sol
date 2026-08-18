// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice Matches the calldata shape bb.js's `bb write_solidity_verifier` generates for a
///         Noir/UltraHonk circuit. The D7 sprint's browser harness (see .superpowers/) proved
///         the circuit (RSA-2048/SHA-256 JWT signature + a bound "nonce" claim) proves and
///         verifies correctly client-side; wiring the actual generated verifier in here is the
///         mechanical follow-up once that's compiled for the target circuit. This prototype
///         integrates against the interface with a mock, per the sprint's scope (spec + wiring,
///         not a from-scratch verifier).
interface IUltraHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
