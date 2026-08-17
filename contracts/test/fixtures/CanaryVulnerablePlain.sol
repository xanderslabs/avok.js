// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice Slither-analyzer canary: a deliberately planted, unprotected `selfdestruct` (Slither's
///         `suicidal` detector), in a contract that does NOT inherit Calibur. Slither must flag
///         this. Paired with CanaryVulnerableCalibur.sol, which plants the identical bug inside a
///         Calibur-inheriting contract, where Slither is proven (test/SlitherCanary.t.sol) to miss
///         it entirely.
contract CanaryVulnerablePlain {
    function kill() external {
        selfdestruct(payable(msg.sender));
    }
}
