// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IKeyRegistry} from "./interfaces/IKeyRegistry.sol";
import {FieldElement} from "./libraries/FieldElement.sol";

/// @title KeyRegistry
/// @notice Anchored, attested registry of OIDC provider signing keys (JWKS), for the identity
///         recovery guardian type (TDD section 9). Not a DKIM registry: the D7 sprint scrapped
///         the email-reply path (operator-run inbox) and narrowed this to JWKS, which rotates on
///         the order of days-to-weeks rather than DKIM's months, so the anchoring window and
///         grace window below are both short by design.
///
///         Ownership model: a small, named attestor set (roadmap: staking/expansion). No single
///         attestor can make a key usable or force a rotation — only quorum can, and any ONE
///         attestor can freeze a record via contest(). This is deliberately asymmetric: the
///         failure mode of "recovery via a bad key" is worse than "recovery temporarily
///         unavailable," so the registry is built to fail closed.
///
///         `owner` is a single EOA in this prototype for testability. Before any real deployment
///         it MUST be a multisig — it can add/remove attestors and lift contests, which is
///         exactly the kind of single-key blast radius the rest of this system is built to avoid.
contract KeyRegistry is IKeyRegistry {
    using FieldElement for bytes32;
    struct KeyRecord {
        uint40 firstAttestedAt; // anchoring clock start; 0 = record doesn't exist
        uint40 validUntil; // 0 = still the live key per attestors; else rotation-attested time
        uint16 attestationCount;
        uint16 rotationAttestationCount;
        bool contested;
    }

    address public immutable owner;
    uint16 public immutable quorum;
    uint40 public immutable anchorWindow;
    uint40 public immutable graceWindow;

    mapping(address => bool) public isAttestor;
    address[] internal _attestors;

    mapping(bytes32 => KeyRecord) internal _records;
    mapping(bytes32 => mapping(address => bool)) internal _hasAttested;
    mapping(bytes32 => mapping(address => bool)) internal _hasAttestedRotation;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAttestor() {
        if (!isAttestor[msg.sender]) revert NotAttestor();
        _;
    }

    /// @param quorum_ Distinct attestors required before a record can become usable.
    /// @param anchorWindow_ Unchallenged time required after the FIRST attestation, on top of
    ///        quorum, before a record is usable. Defends against a burst of attestations from a
    ///        set that's colluding or has been compromised all at once.
    /// @param graceWindow_ How long a rotated-out key still authorizes proofs after quorum
    ///        attests the rotation. Exists because an id_token signed just before rotation, for
    ///        a recovery flow already in progress, must not go dead mid-flight.
    constructor(address owner_, address[] memory initialAttestors, uint16 quorum_, uint40 anchorWindow_, uint40 graceWindow_) {
        require(owner_ != address(0), "zero owner");
        require(quorum_ > 0 && quorum_ <= initialAttestors.length, "bad quorum");
        owner = owner_;
        quorum = quorum_;
        anchorWindow = anchorWindow_;
        graceWindow = graceWindow_;
        for (uint256 i = 0; i < initialAttestors.length; i++) {
            _addAttestor(initialAttestors[i]);
        }
    }

    function addAttestor(address attestor) external onlyOwner {
        _addAttestor(attestor);
    }

    function _addAttestor(address attestor) internal {
        if (isAttestor[attestor]) revert AlreadyAttestor();
        isAttestor[attestor] = true;
        _attestors.push(attestor);
        emit AttestorAdded(attestor);
    }

    /// @dev Removing an attestor does NOT retroactively strip their past attestations from any
    ///      existing record: `attestationCount` and `_hasAttested` are a historical ledger of who
    ///      confirmed a key was live at the time, not a live poll of the current attestor set. A
    ///      record that already reached quorum stays usable on those grounds even if every
    ///      attestor who contributed to it is later removed. This is intentional, not an
    ///      oversight — unwinding past attestations on removal would mean a key that was live
    ///      yesterday, correctly and unanimously attested, could silently stop being usable today
    ///      because of an unrelated governance change, which is a worse failure mode than the
    ///      stale-consensus risk it would guard against. Forward-looking risk (a removed
    ///      attestor's future opinion) is what removal actually protects against, and it does.
    function removeAttestor(address attestor) external onlyOwner {
        if (!isAttestor[attestor]) revert UnknownAttestor();
        // A record can only ever reach quorum if enough LIVE attestors are left to each cast one
        // attest() — dropping below quorum wouldn't corrupt anything that already reached it, but
        // it would silently stall every record that hasn't yet, with no revert or event to notice
        // by. Fail loud instead: this is an operational misconfiguration, not a valid state.
        if (_attestors.length - 1 < quorum) revert BelowQuorum();
        isAttestor[attestor] = false;
        uint256 len = _attestors.length;
        // Owner-only op over a small, deliberately-named attestor set (TDD section 9: "small and
        // named at launch"), not user-controlled or unboundedly growable — the loop's cost is
        // capped by governance, not an attacker.
        for (uint256 i = 0; i < len; i++) {
            if (_attestors[i] == attestor) {
                _attestors[i] = _attestors[len - 1];
                // slither-disable-next-line costly-loop
                _attestors.pop();
                break;
            }
        }
        emit AttestorRemoved(attestor);
    }

    function attestors() external view returns (address[] memory) {
        return _attestors;
    }

    function recordId(string calldata issuer, string calldata kid, bytes32 keyHash) public pure returns (bytes32) {
        return keccak256(abi.encode(issuer, kid, keyHash));
    }

    function attest(string calldata issuer, string calldata kid, bytes32 keyHash) external onlyAttestor {
        if (!keyHash.isField()) revert NotFieldElement();
        bytes32 id = recordId(issuer, kid, keyHash);
        KeyRecord storage r = _records[id];
        if (_hasAttested[id][msg.sender]) revert AlreadyAttested();
        _hasAttested[id][msg.sender] = true;
        if (r.firstAttestedAt == 0) {
            r.firstAttestedAt = uint40(block.timestamp);
        }
        r.attestationCount += 1;
        emit KeyAttested(id, msg.sender, r.attestationCount);
    }

    function contest(string calldata issuer, string calldata kid, bytes32 keyHash) external onlyAttestor {
        bytes32 id = recordId(issuer, kid, keyHash);
        if (_records[id].firstAttestedAt == 0) revert NoSuchRecord();
        _records[id].contested = true;
        emit KeyContested(id, msg.sender);
    }

    /// @notice Lift a contest. Deliberately owner-only, not attestor-quorum: contest is meant to
    ///         be a fast, single-party brake; lifting it is a considered, accountable action.
    function uncontest(string calldata issuer, string calldata kid, bytes32 keyHash) external onlyOwner {
        bytes32 id = recordId(issuer, kid, keyHash);
        if (_records[id].firstAttestedAt == 0) revert NoSuchRecord();
        _records[id].contested = false;
    }

    /// @dev One-way door: there is no un-rotate. Once rotationAttestationCount reaches quorum,
    ///      validUntil is set and isKeyUsable's grace window starts counting down toward
    ///      permanently false — nothing here can push validUntil back to 0. A mistaken rotation
    ///      attestation is NOT recoverable by reversing it; the fix is attesting the correct
    ///      (issuer, kid, keyHash) as a fresh record. This mirrors contest/uncontest's asymmetry
    ///      on purpose: a fail-closed system should always find it easier to make something
    ///      MORE restricted than to walk a restriction back on the same record.
    function attestRotated(string calldata issuer, string calldata kid, bytes32 keyHash) external onlyAttestor {
        bytes32 id = recordId(issuer, kid, keyHash);
        KeyRecord storage r = _records[id];
        if (r.firstAttestedAt == 0) revert NoSuchRecord();
        if (r.validUntil != 0) revert AlreadyLive(); // already marked rotated; nothing to do
        if (_hasAttestedRotation[id][msg.sender]) revert AlreadyAttested();
        _hasAttestedRotation[id][msg.sender] = true;
        r.rotationAttestationCount += 1;
        emit KeyRotationAttested(id, msg.sender, r.rotationAttestationCount);
        if (r.rotationAttestationCount >= quorum) {
            r.validUntil = uint40(block.timestamp);
            emit KeyRotated(id, r.validUntil);
        }
    }

    function isKeyUsable(string calldata issuer, string calldata kid, bytes32 keyHash) external view returns (bool) {
        KeyRecord storage r = _records[recordId(issuer, kid, keyHash)];
        if (r.firstAttestedAt == 0) return false;
        if (r.contested) return false;
        if (r.attestationCount < quorum) return false;
        // slither-disable-next-line timestamp
        if (block.timestamp < uint256(r.firstAttestedAt) + anchorWindow) return false;
        if (r.validUntil != 0) {
            // slither-disable-next-line timestamp
            if (block.timestamp > uint256(r.validUntil) + graceWindow) return false;
        }
        return true;
    }
}
