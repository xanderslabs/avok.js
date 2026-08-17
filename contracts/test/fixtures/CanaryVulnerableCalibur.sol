// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Calibur} from "calibur/Calibur.sol";

/// @notice Slither-analyzer canary: the IDENTICAL planted bug as CanaryVulnerablePlain.sol (an
///         unprotected `selfdestruct`), but inheriting Calibur. Slither cannot build IR for
///         Calibur's ERC7739._isValidTypedDataSig (a destructured-calldata-tuple parsing bug,
///         upstream, verified present on Slither 0.11.5/0.11.6), so every contract inheriting
///         Calibur — including this one and AvokCalibur — is dropped from analysis entirely.
///         test/SlitherCanary.t.sol asserts this contract is invisible to Slither where the plain
///         fixture is not, so a future Slither fix flips the canary and tells us the blind spot
///         closed.
contract CanaryVulnerableCalibur is Calibur {
    function kill() external {
        selfdestruct(payable(msg.sender));
    }
}
