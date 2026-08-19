// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IOidcRecoveryGuardian} from "./interfaces/IOidcRecoveryGuardian.sol";
import {IKeyRegistry} from "./interfaces/IKeyRegistry.sol";
import {IUltraHonkVerifier} from "./interfaces/IUltraHonkVerifier.sol";
import {IGuardianLogic} from "./interfaces/IGuardianLogic.sol";
import {FieldElement} from "./libraries/FieldElement.sol";

/// @title OidcRecoveryGuardian
/// @notice The identity guardian type from TDD section 9 / the D7 sprint refocus: a single
///         shared contract that submits one GuardianLogic approval per verified proof. It is
///         added as an ordinary guardian address via GuardianLogic.setupGuardians /
///         proposeGuardianOp on each wallet that wants it — this contract has no special power
///         over GuardianLogic beyond what any guardian address has, and GuardianLogic itself is
///         unmodified. A compromised KeyRegistry or a stolen proof can start a recovery attempt;
///         it still has to survive the wallet's own threshold, timelock, and veto window.
///
///         Per-wallet state (recovery identity commitment) lives here, not in the wallet's own
///         storage — unlike GuardianLogic, this contract is a shared service by design (same
///         category as KeyRegistry), so that's the natural home for it.
contract OidcRecoveryGuardian is IOidcRecoveryGuardian {
    using FieldElement for bytes32;

    uint256 internal constant PUBKEY_HASH_INDEX = 0;
    uint256 internal constant IDENTITY_INDEX = 1;
    uint256 internal constant NONCE_BINDING_INDEX = 2;
    uint256 internal constant PUBLIC_INPUTS_LENGTH = 3;

    uint40 public constant IDENTITY_CHANGE_DELAY = 12 hours;

    IKeyRegistry public immutable registry;
    IUltraHonkVerifier public immutable verifier;

    struct IdentityConfig {
        bytes32 commitment;
        bytes32 pendingCommitment;
        uint40 pendingReadyAt;
    }

    mapping(address => IdentityConfig) internal _identity;

    constructor(IKeyRegistry registry_, IUltraHonkVerifier verifier_) {
        registry = registry_;
        verifier = verifier_;
    }

    function setRecoveryIdentity(bytes32 commitment) external {
        // commitment is compared directly against a circuit's public output later — it must
        // already be a canonical BN254 field element (see FieldElement.sol), or no real proof
        // could ever match it.
        if (!commitment.isField()) revert NotFieldElement();
        IdentityConfig storage c = _identity[msg.sender];
        if (c.commitment == bytes32(0)) {
            c.commitment = commitment;
            emit RecoveryIdentitySet(msg.sender, commitment);
            return;
        }
        c.pendingCommitment = commitment;
        c.pendingReadyAt = uint40(block.timestamp) + IDENTITY_CHANGE_DELAY;
        emit RecoveryIdentityChangeProposed(msg.sender, commitment, c.pendingReadyAt);
    }

    function vetoRecoveryIdentityChange() external {
        IdentityConfig storage c = _identity[msg.sender];
        if (c.pendingReadyAt == 0) revert NoChangePending();
        delete c.pendingCommitment;
        delete c.pendingReadyAt;
        emit RecoveryIdentityChangeVetoed(msg.sender);
    }

    function applyRecoveryIdentityChange(address wallet) external {
        IdentityConfig storage c = _identity[wallet];
        if (c.pendingReadyAt == 0) revert NoChangePending();
        // The 12h identity-change timelock IS the feature: readyAt is set from block.timestamp at
        // propose time, and miner timestamp manipulation (~seconds) is irrelevant against a fixed
        // 12h delay — same reasoning GuardianLogic already applies to its own timelocks.
        // slither-disable-next-line timestamp
        if (block.timestamp < c.pendingReadyAt) revert ChangeNotReady();
        c.commitment = c.pendingCommitment;
        delete c.pendingCommitment;
        delete c.pendingReadyAt;
        emit RecoveryIdentityChangeApplied(wallet, c.commitment);
    }

    function getRecoveryIdentity(address wallet)
        external
        view
        returns (bytes32 commitment, bytes32 pendingCommitment, uint40 pendingReadyAt)
    {
        IdentityConfig storage c = _identity[wallet];
        return (c.commitment, c.pendingCommitment, c.pendingReadyAt);
    }

    function submitRecoveryApproval(
        address wallet,
        address promoteKey,
        uint64 nonce,
        string calldata issuer,
        string calldata kid,
        bytes32 keyHash,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external {
        if (publicInputs.length != PUBLIC_INPUTS_LENGTH) revert InvalidProof();

        bytes32 commitment = _identity[wallet].commitment;
        // Both flagged by Slither's timestamp/incorrect-equality heuristics; neither is a
        // balance or timestamp comparison — these are bytes32 identity-commitment equality
        // checks (unset-sentinel and proof-vs-registered-identity match).
        // slither-disable-next-line incorrect-equality,timestamp
        if (commitment == bytes32(0)) revert NoIdentityConfigured();

        // Cheap checks before the expensive one: a stale key or a wrong identity/nonce binding
        // should never reach the verifier.
        if (!registry.isKeyUsable(issuer, kid, keyHash)) revert KeyNotUsable();
        if (publicInputs[PUBKEY_HASH_INDEX] != keyHash) revert KeyNotUsable();
        // slither-disable-next-line incorrect-equality,timestamp
        if (publicInputs[IDENTITY_INDEX] != commitment) revert IdentityMismatch();

        // Masked to a canonical field element for the same reason identity and pubkeyHash are:
        // this value is compared directly against a circuit's public output, which can only ever
        // be a BN254 field element (see FieldElement.sol).
        bytes32 expectedNonceBinding = keccak256(abi.encode(wallet, promoteKey, nonce, block.chainid)).toField();
        if (publicInputs[NONCE_BINDING_INDEX] != expectedNonceBinding) revert NonceBindingMismatch();

        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        // Emit before the external call: wallet is a guardian's own recovery target, not
        // arbitrary untrusted code, but ordering the event ahead of the call costs nothing and
        // keeps the log's meaning unambiguous even if a future wallet implementation reenters.
        emit IdentityRecoveryApproved(wallet, promoteKey, nonce, issuer);
        IGuardianLogic(wallet).approveRecovery(promoteKey, nonce);
    }
}
