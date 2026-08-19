// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IKeyRegistry {
    error NotAttestor();
    error AlreadyAttestor();
    error UnknownAttestor();
    error AlreadyAttested();
    error NoSuchRecord();
    error AlreadyLive();
    error NotFieldElement();
    error BelowQuorum();

    event AttestorAdded(address indexed attestor);
    event AttestorRemoved(address indexed attestor);
    event KeyAttested(bytes32 indexed recordId, address indexed attestor, uint16 attestationCount);
    event KeyContested(bytes32 indexed recordId, address indexed attestor);
    event KeyRotationAttested(bytes32 indexed recordId, address indexed attestor, uint16 attestationCount);
    event KeyRotated(bytes32 indexed recordId, uint40 validUntil);

    /// @notice Attest that `keyHash` is the current signing key for (issuer, kid). Idempotent
    ///         per (record, attestor); the anchoring clock starts on the FIRST attestation, not
    ///         the quorum-reaching one, so a slow-to-agree attestor set doesn't reset the window.
    ///         `keyHash` must already be a canonical BN254 field element (see FieldElement.sol) —
    ///         this is the value OidcRecoveryGuardian later compares directly against a real
    ///         circuit's public input, so a non-canonical value here can never match one there.
    function attest(string calldata issuer, string calldata kid, bytes32 keyHash) external;

    /// @notice Flag a record as contested. One attestor's word is enough to freeze usability —
    ///         fail-safe: a compromised or careless attestor can block a recovery, never force one.
    function contest(string calldata issuer, string calldata kid, bytes32 keyHash) external;

    /// @notice Attest that (issuer, kid, keyHash) has rotated out. Quorum starts the grace window;
    ///         same anchoring discipline as attest().
    function attestRotated(string calldata issuer, string calldata kid, bytes32 keyHash) external;

    /// @notice True only if: quorum met, anchoring window elapsed, not contested, and — if
    ///         rotated — still inside the post-rotation grace window. This is the one function
    ///         OidcRecoveryGuardian calls; everything else here is attestor-facing.
    function isKeyUsable(string calldata issuer, string calldata kid, bytes32 keyHash)
        external
        view
        returns (bool);

    function recordId(string calldata issuer, string calldata kid, bytes32 keyHash)
        external
        pure
        returns (bytes32);
}
