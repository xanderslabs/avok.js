// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Calibur} from "calibur/Calibur.sol";
import {Key, KeyType, KeyLib} from "calibur/libraries/KeyLib.sol";
import {Settings} from "calibur/libraries/SettingsLib.sol";
import {IAvokCalibur} from "./interfaces/IAvokCalibur.sol";
import {IGuardianLogic} from "./interfaces/IGuardianLogic.sol";

/// @title AvokCalibur
/// @notice Uniswap's Calibur, plus named shims onto GuardianLogic and one promotion hook.
/// @dev Each shim's body is a mechanical delegatecall (raw calldata forwarded, raw returndata
///      returned); all branching logic lives in GuardianLogic, which is Slither-analyzable. The
///      shims are named and typed (rather than a catch-all fallback) so the wallet's guardian
///      surface is visible in AvokCalibur's own source and published ABI, not just discoverable
///      by knowing it forwards to GuardianLogic.
///
///      They cannot be declared `view`, even though several read storage only: the compiler
///      rejects DELEGATECALL inside a function it can statically prove is state-mutating-capable.
///      That is inherent to any delegatecall-based accessor (the same reason transparent-proxy
///      read paths aren't `view` either) — GuardianLogic must run via delegatecall, not staticcall,
///      because it reads THIS wallet's own storage, not its own.
contract AvokCalibur is Calibur, IAvokCalibur {
    address public immutable GUARDIAN_LOGIC;

    constructor(address guardianLogic) {
        GUARDIAN_LOGIC = guardianLogic;
    }

    function _forward() internal {
        address logic = GUARDIAN_LOGIC;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), logic, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    function setupGuardians(address[] calldata, uint8, uint40, uint40) external {
        _forward();
    }

    function getGuardianConfig() external returns (address[] memory, uint8, uint40, uint40) {
        _forward();
    }

    function proposeGuardianOp(IGuardianLogic.GuardianOp calldata) external {
        _forward();
    }

    function executeGuardianOp(IGuardianLogic.GuardianOp calldata) external {
        _forward();
    }

    function vetoGuardianOp(bytes32) external {
        _forward();
    }

    function getPendingGuardianOp(bytes32) external returns (uint40) {
        _forward();
    }

    function approveRecovery(address, uint64) external {
        _forward();
    }

    function approveRecoveryBySig(address, uint64, address, bytes calldata) external {
        _forward();
    }

    function getPendingRecovery() external returns (address, uint64, uint8, uint40) {
        _forward();
    }

    function recoveryApprovalDigest(address, uint64) external returns (bytes32) {
        _forward();
    }

    function vetoRecovery() external {
        _forward();
    }

    function executeRecovery() external {
        _forward();
    }

    /// @notice Registers a recovered key as an admin signer. Reachable only as a self-call, and
    ///         the only writer is GuardianLogic.executeRecovery, which deletes the pending
    ///         recovery before calling (no replay).
    function registerRecoveredKey(address promoteKey) external {
        if (msg.sender != address(this)) revert IGuardianLogic.NotSelf();
        Key memory key = Key({keyType: KeyType.Secp256k1, publicKey: abi.encode(promoteKey)});
        this.register(key);
        this.update(KeyLib.hash(key), Settings.wrap(uint256(1) << 200));
    }
}
