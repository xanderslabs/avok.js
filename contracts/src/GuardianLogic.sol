// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IGuardianLogic} from "./interfaces/IGuardianLogic.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {IGuardianPromotion} from "./interfaces/IGuardianLogic.sol";

/// @title GuardianLogic
/// @notice Stateless rulebook for Avok guardian recovery. Always reached by delegatecall
///         from the wallet (AvokCalibur shims), so all storage reads and writes land in
///         the calling wallet's own account storage, under the `avok.guardians` ERC-7201
///         namespace. This contract inherits nothing from Calibur on purpose: it is the
///         analyzable half of the recovery design (see the contract architecture doc).
contract GuardianLogic is IGuardianLogic {
    uint40 internal constant MIN_DELAY = 1 hours;
    uint40 internal constant MAX_DELAY = 30 days;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant DOMAIN_NAME_HASH = keccak256("Avok Guardians");
    bytes32 internal constant DOMAIN_VERSION_HASH = keccak256("1");
    bytes32 internal constant RECOVERY_APPROVAL_TYPEHASH =
        keccak256("RecoveryApproval(address promoteKey,uint64 nonce)");

    struct GuardianStore {
        address[] guardians;
        mapping(address => bool) isGuardian;
        uint8 threshold;
        uint40 recoveryDelay;
        uint40 guardianOpDelay;
        // Separate replay-protection counters: an ordinary guardian-roster change must never
        // invalidate an in-flight recovery's approvals, and vice versa.
        uint64 opNonce;
        uint64 recoveryNonce;
        mapping(bytes32 => uint40) pendingOps;
        PendingRecovery pendingRecovery;
        mapping(bytes32 => bool) approved;
    }

    struct PendingRecovery {
        address promoteKey;
        uint64 nonce;
        uint8 approvals;
        uint40 readyAt;
    }

    // keccak256(abi.encode(uint256(keccak256("avok.guardians")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 public constant STORE_SLOT =
        0x1c915f68067804c003af5dc29577410eddd8b82b8e46e8541c9e35db1bb1cf00;

    function _store() internal pure returns (GuardianStore storage s) {
        bytes32 slot = STORE_SLOT;
        // ERC-7201 namespaced storage requires a raw slot assignment; there is no non-assembly way
        // to point a storage pointer at a computed slot.
        // slither-disable-next-line assembly
        assembly { s.slot := slot }
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    function setupGuardians(
        address[] calldata guardians,
        uint8 threshold,
        uint40 recoveryDelay,
        uint40 guardianOpDelay
    ) external onlySelf {
        GuardianStore storage s = _store();
        if (s.guardians.length != 0) revert AlreadySetup();
        _validate(guardians.length, threshold, recoveryDelay, guardianOpDelay);
        for (uint256 i = 0; i < guardians.length; i++) {
            if (s.isGuardian[guardians[i]]) revert DuplicateGuardian();
            s.isGuardian[guardians[i]] = true;
            s.guardians.push(guardians[i]);
        }
        s.threshold = threshold;
        s.recoveryDelay = recoveryDelay;
        s.guardianOpDelay = guardianOpDelay;
        emit GuardiansSetup(guardians, threshold, recoveryDelay, guardianOpDelay);
    }

    function getGuardianConfig()
        external
        view
        returns (address[] memory, uint8, uint40, uint40)
    {
        GuardianStore storage s = _store();
        return (s.guardians, s.threshold, s.recoveryDelay, s.guardianOpDelay);
    }

    function _validate(uint256 count, uint8 threshold, uint40 rd, uint40 gd) internal pure {
        if (threshold == 0 || threshold > count) revert BadThreshold();
        if (rd < MIN_DELAY || rd > MAX_DELAY || gd < MIN_DELAY || gd > MAX_DELAY) {
            revert DelayOutOfBounds();
        }
    }

    function proposeGuardianOp(GuardianOp calldata op) external onlySelf {
        GuardianStore storage s = _store();
        if (s.guardians.length == 0) revert NotSetup();
        if (op.nonce != s.opNonce) revert NonceUsed();
        s.opNonce = op.nonce + 1;
        bytes32 opHash = keccak256(abi.encode(op));
        uint40 readyAt = uint40(block.timestamp) + s.guardianOpDelay;
        s.pendingOps[opHash] = readyAt;
        emit GuardianOpProposed(opHash, op, readyAt);
    }

    function vetoGuardianOp(bytes32 opHash) external onlySelf {
        GuardianStore storage s = _store();
        if (s.pendingOps[opHash] == 0) revert OpNotPending();
        delete s.pendingOps[opHash];
        emit GuardianOpVetoed(opHash);
    }

    function executeGuardianOp(GuardianOp calldata op) external onlySelf {
        GuardianStore storage s = _store();
        bytes32 opHash = keccak256(abi.encode(op));
        uint40 readyAt = s.pendingOps[opHash];
        if (readyAt == 0) revert OpNotPending();
        // The vetoable timelock IS the feature: readyAt is set from block.timestamp at propose
        // time, and miner timestamp manipulation (~seconds) is irrelevant against a 1h-30d delay.
        // slither-disable-next-line timestamp
        if (block.timestamp < readyAt) revert OpNotReady();
        delete s.pendingOps[opHash];
        _applyOp(s, op);
        emit GuardianOpExecuted(opHash);
    }

    function getPendingGuardianOp(bytes32 opHash) external view returns (uint40 readyAt) {
        return _store().pendingOps[opHash];
    }

    function approveRecovery(address promoteKey, uint64 nonce) external {
        GuardianStore storage s = _store();
        if (!s.isGuardian[msg.sender]) revert NotGuardian();
        if (nonce != s.recoveryNonce) revert NonceUsed();
        _approve(s, msg.sender, promoteKey, nonce);
    }

    function getPendingRecovery()
        external
        view
        returns (address promoteKey, uint64 nonce, uint8 approvals, uint40 readyAt)
    {
        PendingRecovery storage r = _store().pendingRecovery;
        return (r.promoteKey, r.nonce, r.approvals, r.readyAt);
    }

    function _approve(GuardianStore storage s, address guardian, address promoteKey, uint64 nonce) internal {
        PendingRecovery storage r = s.pendingRecovery;
        if (r.approvals == 0) {
            if (promoteKey == address(0)) revert ZeroKey();
            r.promoteKey = promoteKey;
            r.nonce = nonce;
        } else if (r.promoteKey != promoteKey) {
            revert RecoveryMismatch();
        }
        bytes32 key = keccak256(abi.encode(guardian, promoteKey, nonce));
        if (s.approved[key]) revert AlreadyApproved();
        s.approved[key] = true;
        r.approvals += 1;
        emit RecoveryApproved(guardian, promoteKey, nonce);
        if (r.approvals == s.threshold) {
            r.readyAt = uint40(block.timestamp) + s.recoveryDelay;
            emit RecoveryStarted(promoteKey, r.readyAt);
        }
    }

    function approveRecoveryBySig(address promoteKey, uint64 nonce, address guardian, bytes calldata sig) external {
        GuardianStore storage s = _store();
        bytes32 digest = _recoveryApprovalDigest(promoteKey, nonce);
        if (ECDSA.recoverCalldata(digest, sig) != guardian) revert BadSignature();
        if (!s.isGuardian[guardian]) revert NotGuardian();
        if (nonce != s.recoveryNonce) revert NonceUsed();
        _approve(s, guardian, promoteKey, nonce);
    }

    function recoveryApprovalDigest(address promoteKey, uint64 nonce) external view returns (bytes32) {
        return _recoveryApprovalDigest(promoteKey, nonce);
    }

    function _recoveryApprovalDigest(address promoteKey, uint64 nonce) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, block.chainid, address(this))
        );
        bytes32 structHash = keccak256(abi.encode(RECOVERY_APPROVAL_TYPEHASH, promoteKey, nonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function vetoRecovery() external onlySelf {
        GuardianStore storage s = _store();
        PendingRecovery storage r = s.pendingRecovery;
        if (r.promoteKey == address(0)) revert NoRecovery();
        address promoteKey = r.promoteKey;
        delete s.pendingRecovery;
        s.recoveryNonce += 1;
        emit RecoveryVetoed(promoteKey);
    }

    function executeRecovery() external {
        GuardianStore storage s = _store();
        PendingRecovery storage r = s.pendingRecovery;
        if (r.promoteKey == address(0)) revert NoRecovery();
        // The 24h recovery timelock IS the feature: readyAt is set from block.timestamp when the
        // approval threshold is reached, and miner timestamp manipulation (~seconds) is irrelevant
        // against a 1h-30d delay.
        // slither-disable-next-line timestamp
        if (r.readyAt == 0 || block.timestamp < r.readyAt) revert RecoveryNotReady();
        address promoteKey = r.promoteKey;
        delete s.pendingRecovery;
        s.recoveryNonce += 1;
        emit RecoveryExecuted(promoteKey);
        IGuardianPromotion(address(this)).registerRecoveredKey(promoteKey);
    }

    function _applyOp(GuardianStore storage s, GuardianOp calldata op) internal {
        if (op.kind == OpKind.Add) {
            if (s.isGuardian[op.guardian]) revert DuplicateGuardian();
            s.isGuardian[op.guardian] = true;
            s.guardians.push(op.guardian);
        } else if (op.kind == OpKind.Remove) {
            if (!s.isGuardian[op.guardian]) revert UnknownGuardian();
            s.isGuardian[op.guardian] = false;
            uint256 len = s.guardians.length;
            for (uint256 i = 0; i < len; i++) {
                if (s.guardians[i] == op.guardian) {
                    s.guardians[i] = s.guardians[len - 1];
                    s.guardians.pop();
                    break;
                }
            }
            if (s.threshold > s.guardians.length) revert BadThreshold();
            _revokeApprovalIfPending(s, op.guardian);
        } else {
            if (op.newThreshold == 0 || op.newThreshold > s.guardians.length) revert BadThreshold();
            s.threshold = op.newThreshold;
        }
    }

    /// @dev A removed guardian's vote on the currently pending recovery (if any) must stop
    ///      counting immediately: it is no longer a decision a current guardian made. If that
    ///      drops approvals below threshold, the recovery clock (if started) resets too — the
    ///      timelock should only ever run on a still-valid quorum.
    function _revokeApprovalIfPending(GuardianStore storage s, address guardian) internal {
        PendingRecovery storage r = s.pendingRecovery;
        if (r.promoteKey == address(0)) return;
        bytes32 key = keccak256(abi.encode(guardian, r.promoteKey, r.nonce));
        if (!s.approved[key]) return;
        s.approved[key] = false;
        r.approvals -= 1;
        if (r.approvals < s.threshold) {
            r.readyAt = 0;
        }
    }
}
