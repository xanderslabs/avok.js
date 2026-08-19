// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IUltraHonkVerifier} from "../../src/interfaces/IUltraHonkVerifier.sol";

/// @dev Stand-in for the bb.js-generated UltraHonk verifier. Tests set whether the next call
///      succeeds; this contract does not care about the shape of `proof`, only that the real
///      one would reject any (proof, publicInputs) pair that doesn't match — the tests that
///      matter here are OidcRecoveryGuardian's OWN checks (key usability, identity, nonce
///      binding), which run before the verifier and don't depend on real proof bytes.
contract MockVerifier is IUltraHonkVerifier {
    bool public nextResult = true;

    function setNextResult(bool ok) external {
        nextResult = ok;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return nextResult;
    }
}
