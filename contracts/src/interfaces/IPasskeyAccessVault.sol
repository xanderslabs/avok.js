// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @title Passkey access-slot vault
/// @notice A wallet holds one key, reachable through N independent credentials ("passkeys"). Each
///         credential stores an access slot: the wallet key encrypted under a key derived from THAT
///         credential's PRF. The wallet survives while any one passkey survives.
///
///         This interface is K-NEUTRAL. It seals whatever 32-byte key the account already has and
///         says nothing about where that key came from — a wallet with a random key can adopt it
///         without changing how its key is born. A PROFILE may additionally define K's derivation:
///         under Seedless Founding Key, K = HKDF(PRF) and the founding key derives it directly and
///         stores no slot, which is what makes wallet creation free. Do not read that profile's
///         behaviour into this interface.
///
///         Nothing in a slot binds an RP-ID, so the passkeys MAY live under multiple independent
///         domains — which is the point: a wallet is not hostage to one domain's survival.
///
///         "Backup" is deliberately not used: nothing here is a copy of anything, and the passkeys
///         are peers.
interface IPasskeyAccessVault {
    error EmptyBlob();
    error BlobTooLarge();
    error AccessSlotMissing();
    error TooManyAccessSlots();
    error MetaTooLarge();
    /// @dev The write was not authorized as the account itself. Standard so a client can decode the
    ///      SECURITY-relevant failure uniformly across implementations — the other five are value
    ///      checks; this is the one that means someone tried.
    error Unauthorized();

    /// @dev `slotId` is deliberately NOT indexed. An indexed topic is cheaply filterable, and a
    ///      filterable slot id would let anyone holding one walk back to the wallet that owns it.
    ///      `wallet` stays indexed so an owner can read their own vault's history.
    event AccessSlotAdded(address indexed wallet, bytes32 slotId, bytes32 blobHash, uint64 version);
    event AccessSlotRemoved(address indexed wallet, bytes32 indexed slotId);

    /// @param slotId keccak256(walletAddress ‖ credentialId) — NOT keccak256(credentialId) alone.
    ///        The address binding is a PRIVACY REQUIREMENT. A credential id is transmitted to the
    ///        relying party on EVERY WebAuthn assertion, so every RP a user has ever authenticated to
    ///        holds it. Hashing it alone would let any of them compute this slot id and locate the
    ///        user's wallet on chain. Binding the address makes the slot id uncomputable without
    ///        already knowing the address — which is the very thing an RP is trying to learn.
    /// @param encryptedBlob the canonical 61-byte envelope: version(1) || iv(12) || ciphertext(48).
    /// @param encryptedMeta opaque per-slot metadata ciphertext (e.g. the enrolling rp-id), readable
    ///        only by a holder of the wallet key. MAY be empty. Never plaintext — a cleartext rp-id
    ///        on chain would reveal which domains trust this wallet.
    function addAccessSlot(bytes32 slotId, bytes calldata encryptedBlob, bytes calldata encryptedMeta) external;

    /// @notice REMOVE AN ACCESS SLOT — free it. This is housekeeping, NOT a security control, and an
    ///         implementation MUST NOT present it as one.
    ///
    ///         What it does: `delete`s the slot's ciphertext and metadata (not merely a flag — a flag
    ///         would leave the bytes readable and the getter would still hand them back) and frees the
    ///         slot so the wallet can enrol another. That last part is why this function exists at all:
    ///         MAX_ACCESS_SLOTS is bounded, so without removal a wallet that fills its slots could
    ///         never add another access slot.
    ///
    ///         What it does NOT do, and cannot:
    ///           - It does not GUARANTEE the key was never kept. On a faithful client — one that
    ///             discards K after each use, as implementations SHOULD — removing a slot does end
    ///             that credential's access: no blob, nothing to reconstruct K from. But to sign, a
    ///             passkey must materialise K in memory, so a ceremony that was malicious or modified
    ///             could have retained it, and no on-chain action un-copies a key. Effective
    ///             revocation in the honest case; not a cryptographic guarantee in the adversarial
    ///             one. (ERC-core §6.3.)
    ///           - It does not erase the blob. The blob was public calldata to `addAccessSlot` and
    ///             remains in the chain's history forever — retained by every full node, not merely
    ///             archive nodes. Anyone who kept a copy (a domain that enrolled a passkey trivially did)
    ///             is unaffected.
    ///           - It cannot be aimed by a trusted party at an untrusted one. Every passkey signs as the
    ///             same K, so the contract cannot tell them apart: ANY passkey can close ANY other.
    ///
    ///         THE ONLY SUFFICIENT REMEDY FOR A COMPROMISED DEVICE IS TO MOVE THE FUNDS to a new
    ///         account (ERC-core §6.3). Removing an access slot is not a substitute and no UI may imply it.
    function removeAccessSlot(bytes32 slotId) external;

    /// @return encryptedBlob the stored envelope
    /// @return active whether the slot is live
    /// @return version monotonic per-slot write counter (rollback / tamper detection)
    /// @return addedAt unix seconds of the block that FIRST added this slot (the roster shows
    ///         this so a user can tell access slots apart to remove one; it is not moved by a rewrite)
    function getAccessSlot(bytes32 slotId)
        external
        view
        returns (bytes memory encryptedBlob, bool active, uint64 version, uint64 addedAt);

    /// @notice The opaque metadata ciphertext for an access slot (empty if none). The resolve path never
    ///         reads this — it is a settings/roster read — so it is a separate getter, not part of
    ///         getAccessSlot.
    function getAccessSlotMeta(bytes32 slotId) external view returns (bytes memory);

    /// @notice Every active slot id for this wallet. Bounded by `maxAccessSlots()`.
    /// @dev Enumeration exists so a wallet can MANAGE its access slots: you cannot aim a removal at an access slot
    ///      you cannot list. An observer with the address learns the slot ids and the access-slot count —
    ///      they could already read the count, and a slot id is keccak256(address ‖ credentialId),
    ///      so it joins to nothing they do not already hold.
    ///
    ///      ORDER IS UNSPECIFIED, and it CHANGES on removal. Implementations may swap-and-pop, so the
    ///      last slot can take a removed slot's index. Never use a position as an identifier — only
    ///      `slotId` is stable — and never page this list across a removal.
    function getAccessSlotIds() external view returns (bytes32[] memory);

    function accessSlotCount() external view returns (uint256);

    /// @notice Every active slot id AND its metadata ciphertext, in one call.
    /// @dev The roster screen needs both, and `getAccessSlotIds` + one `getAccessSlotMeta` per slot is
    ///      1+N round trips (33 at the cap). This is the settings-path read; `getAccessSlot` stays lean
    ///      for the login path, which never wants metadata. Same ordering caveat as `getAccessSlotIds`.
    /// @return ids the active slot ids
    /// @return metas `metas[i]` is the metadata ciphertext for `ids[i]`; empty where a slot has none
    function getAccessSlots() external view returns (bytes32[] memory ids, bytes[] memory metas);

    /// @notice The ERC-7201 storage root this implementation puts its vault at.
    /// @dev In the interface, not merely the implementation, because it is the ONE check that makes
    ///      "any wallet can implement this standard" verifiable rather than claimed: a reader confirms
    ///      an implementation really does put its slots where the standard says, WITHOUT trusting its
    ///      source. A third-party implementation that does not expose it cannot be checked at all.
    ///      MUST equal keccak256(abi.encode(uint256(keccak256("passkey-access-vault.main")) - 1)) &
    ///      ~bytes32(uint256(0xff)).
    function accessVaultStorageRoot() external pure returns (bytes32);

    /// @notice The bounds this implementation enforces.
    /// @dev Readable because they are implementation-defined: the spec REQUIRES bounds and states the
    ///      ones it uses (4096 / 256 / 32) but does not fix them. A UI that hardcodes "3 of 32" is
    ///      wrong against an implementation that chose 16, and had no way to find out.
    ///
    ///      Declared in the constants' own casing so a `uint256 public constant MAX_BLOB_LENGTH`
    ///      satisfies this directly — its auto-generated getter IS the implementation. No wrapper, and
    ///      no second name for one value.
    function MAX_BLOB_LENGTH() external view returns (uint256);

    function MAX_META_LENGTH() external view returns (uint256);

    function MAX_ACCESS_SLOTS() external view returns (uint256);
}
