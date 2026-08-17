// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IGuardianPromotion {
    function registerRecoveredKey(address promoteKey) external;
}

interface IGuardianLogic {
    enum OpKind { Add, Remove, SetThreshold }

    struct GuardianOp {
        OpKind kind;
        address guardian;
        uint8 newThreshold;
        uint64 nonce;
    }

    error NotSelf();
    error AlreadySetup();
    error NotSetup();
    error BadThreshold();
    error DelayOutOfBounds();
    error DuplicateGuardian();
    error OpNotPending();
    error OpNotReady();
    error UnknownGuardian();
    error NonceUsed();
    error NotGuardian();
    error AlreadyApproved();
    error RecoveryMismatch();
    error ZeroKey();
    error BadSignature();
    error NoRecovery();
    error RecoveryNotReady();

    event GuardiansSetup(address[] guardians, uint8 threshold, uint40 recoveryDelay, uint40 guardianOpDelay);
    event GuardianOpProposed(bytes32 opHash, GuardianOp op, uint40 readyAt);
    event GuardianOpVetoed(bytes32 opHash);
    event GuardianOpExecuted(bytes32 opHash);
    event RecoveryApproved(address indexed guardian, address indexed promoteKey, uint64 nonce);
    event RecoveryStarted(address indexed promoteKey, uint40 readyAt);
    event RecoveryVetoed(address indexed promoteKey);
    event RecoveryExecuted(address indexed promoteKey);

    function setupGuardians(
        address[] calldata guardians,
        uint8 threshold,
        uint40 recoveryDelay,
        uint40 guardianOpDelay
    ) external;

    function getGuardianConfig()
        external
        view
        returns (address[] memory guardians, uint8 threshold, uint40 recoveryDelay, uint40 guardianOpDelay);

    function proposeGuardianOp(GuardianOp calldata op) external;

    function executeGuardianOp(GuardianOp calldata op) external;

    function vetoGuardianOp(bytes32 opHash) external;

    function getPendingGuardianOp(bytes32 opHash) external view returns (uint40 readyAt);

    function approveRecovery(address promoteKey, uint64 nonce) external;

    function getPendingRecovery()
        external
        view
        returns (address promoteKey, uint64 nonce, uint8 approvals, uint40 readyAt);

    function approveRecoveryBySig(address promoteKey, uint64 nonce, address guardian, bytes calldata sig) external;

    function recoveryApprovalDigest(address promoteKey, uint64 nonce) external view returns (bytes32);

    function vetoRecovery() external;

    function executeRecovery() external;
}
