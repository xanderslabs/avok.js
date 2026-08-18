// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface IOidcRecoveryGuardian {
    error NoIdentityConfigured();
    error KeyNotUsable();
    error IdentityMismatch();
    error NonceBindingMismatch();
    error InvalidProof();
    error ChangeNotReady();
    error NoChangePending();
    error NotFieldElement();

    event RecoveryIdentitySet(address indexed wallet, bytes32 commitment);
    event RecoveryIdentityChangeProposed(address indexed wallet, bytes32 pendingCommitment, uint40 readyAt);
    event RecoveryIdentityChangeVetoed(address indexed wallet);
    event RecoveryIdentityChangeApplied(address indexed wallet, bytes32 commitment);
    event IdentityRecoveryApproved(address indexed wallet, address indexed promoteKey, uint64 nonce, string issuer);

    /// @notice First call for a wallet sets the recovery identity immediately (mirrors
    ///         GuardianLogic.setupGuardians: initial setup isn't timelocked, only CHANGES are —
    ///         there's nothing to protect against yet on a wallet with no identity configured).
    ///         Every call after that proposes a change, timelocked and vetoable, because a
    ///         signer with transient access must not be able to silently redirect who can
    ///         recover this wallet. `commitment` must be a canonical BN254 field element (see
    ///         FieldElement.sol) — it is compared directly against a circuit's public output.
    ///
    ///         UX note for the product surface, not enforced here: this should be called before
    ///         or atomically with adding this contract's address as a guardian on the wallet.
    ///         Adding the guardian address first, with no identity configured yet, leaves it
    ///         addable-but-inert (submitRecoveryApproval reverts NoIdentityConfigured) — not
    ///         unsafe, but a window where a user could reasonably believe identity recovery is
    ///         live when it isn't.
    function setRecoveryIdentity(bytes32 commitment) external;

    function vetoRecoveryIdentityChange() external;

    function applyRecoveryIdentityChange(address wallet) external;

    function getRecoveryIdentity(address wallet)
        external
        view
        returns (bytes32 commitment, bytes32 pendingCommitment, uint40 pendingReadyAt);

    /// @notice Submits one guardian approval to `wallet`'s GuardianLogic, gated on a Noir/
    ///         UltraHonk proof of a currently-usable JWKS-signed id_token. publicInputs layout
    ///         (fixed, matches the compiled circuit's output order). Every entry is a canonical
    ///         BN254 field element (FieldElement.toField), not a raw keccak256 output — UltraHonk
    ///         public inputs are field elements, and a raw 256-bit hash routinely exceeds the
    ///         field modulus. This convention has to hold on the circuit side too, once the real
    ///         circuit exists: whatever computes these commitments off-chain must mask them the
    ///         same way, or a genuinely correct proof will never match what's checked here.
    ///           [0] pubkeyHash    — toField(keyHash-preimage); must equal keyHash, so the proof
    ///                               can't be replayed against a different provider key than the
    ///                               one KeyRegistry vouches for
    ///           [1] identity      — toField(keccak256(emailHash, sub, issuer)); must equal the
    ///                               wallet's registered recovery identity
    ///           [2] nonceBinding  — toField(keccak256(wallet, promoteKey, nonce, chainid)); the
    ///                               value the relying party must have put in the OAuth request's
    ///                               `nonce` param, which the circuit already asserts equals the
    ///                               token's "nonce" claim
    function submitRecoveryApproval(
        address wallet,
        address promoteKey,
        uint64 nonce,
        string calldata issuer,
        string calldata kid,
        bytes32 keyHash,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external;
}
