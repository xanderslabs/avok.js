// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IPasskeyAccessVault} from "./interfaces/IPasskeyAccessVault.sol";

/// @notice Inheritable access-slot vault. Any EIP-7702 delegate or ERC-4337 account may inherit it.
///         An EIP-7702 account delegates to exactly one address, so the vault cannot be deployed
///         separately — it must be inherited.
///
/// STORAGE IS ERC-7201 NAMESPACED, and that is the whole point. An implementation's own storage is
/// laid out by Solidity's inheritance linearization, which differs per vendor. If the vault lived in
/// ordinary storage, a wallet that re-delegated from one conforming implementation to another would
/// find its slots reinterpreted at whatever those positions mean in the new contract — and a write
/// there would corrupt them. Namespacing roots the vault at a location derived from the namespace id
/// alone, identical in every implementation, so a wallet can change implementations and keep its
/// access slots. Without this, "any wallet can implement this standard" is a slogan, not a property.
abstract contract PasskeyAccessVault is IPasskeyAccessVault {
    uint256 public constant MAX_BLOB_LENGTH = 4096;
    uint256 public constant MAX_ACCESS_SLOTS = 32;
    uint256 public constant MAX_META_LENGTH = 256;

    struct Slot {
        bytes encryptedBlob;
        bytes encryptedMeta; // opaque ciphertext; the contract never interprets it
        bool active; // packs with version + addedAt into one word
        uint64 version;
        uint64 addedAt;
    }

    /// @custom:storage-location erc7201:passkey-access-vault.main
    ///
    /// @dev THIS LAYOUT IS THE COMPATIBILITY CONTRACT. It sits at a fixed root, so adding, removing or
    ///      reordering a field shifts every field after it — a wallet that re-delegates from an
    ///      implementation with a different layout reads its slots from the wrong places. That would
    ///      fail SILENTLY, not loudly. Namespacing exists to make re-delegation safe; changing this
    ///      struct is the one way to defeat it. Treat any edit as a breaking, deliberate re-version.
    struct AccessVaultStorage {
        mapping(bytes32 slotId => Slot) slots;
        // The enumerable index. Its LENGTH is the active count — there is no separate counter, because
        // a second copy of one number can only ever desync from the first.
        bytes32[] slotIds;
        mapping(bytes32 slotId => uint256) indexOfSlot; // 1-based; 0 means "not in the index"
    }

    // keccak256(abi.encode(uint256(keccak256("passkey-access-vault.main")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ACCESS_VAULT_STORAGE =
        0xa4fa4294098059eabd10052f01eef3d8d7de7be8acc14248ecb1c1794a130600;

    /// @notice The ERC-7201 storage root. Exposed so a reader can verify that an implementation
    ///         really does put its slots where the standard says, without trusting its source.
    function accessVaultStorageRoot() public pure returns (bytes32) {
        return ACCESS_VAULT_STORAGE;
    }

    function _vault() private pure returns (AccessVaultStorage storage $) {
        bytes32 root = ACCESS_VAULT_STORAGE;
        assembly {
            $.slot := root
        }
    }

    /// @notice Gate on slot writes. Defaults to the strict check the spec requires.
    ///
    /// @dev ERC-core §3.5: "Writes MUST be authorized as the account itself." That is a FLOOR, not a
    ///      menu. Anything less is a free wallet takeover — an unauthorized `addAccessSlot` installs an
    ///      access slot, i.e. hands the caller a permanent, self-service route to K.
    ///
    ///      THIS HAS A BODY ON PURPOSE. It was abstract, which forced every implementer to write a gate
    ///      — and let any of them write `{}`, which compiles, satisfies the interface, and gates
    ///      nothing. That is OpenZeppelin's `UUPSUpgradeable._authorizeUpgrade` footgun, one of the
    ///      most-exploited shapes in Solidity. An implementer who never reads this paragraph is now
    ///      strict-by-default rather than drained.
    ///
    ///      Override to WIDEN it — a 4337 account may also admit its EntryPoint — but do so
    ///      deliberately, and never to remove the check.
    function _authorizeSlotWrite() internal view virtual {
        if (msg.sender != address(this)) revert Unauthorized();
    }

    function addAccessSlot(bytes32 slotId, bytes calldata encryptedBlob, bytes calldata encryptedMeta) external {
        _authorizeSlotWrite();
        if (encryptedBlob.length == 0) revert EmptyBlob();
        if (encryptedBlob.length > MAX_BLOB_LENGTH) revert BlobTooLarge();
        if (encryptedMeta.length > MAX_META_LENGTH) revert MetaTooLarge();
        AccessVaultStorage storage $ = _vault();
        Slot storage slot = $.slots[slotId];
        if (!slot.active) {
            if ($.slotIds.length >= MAX_ACCESS_SLOTS) revert TooManyAccessSlots();
            $.slotIds.push(slotId);
            $.indexOfSlot[slotId] = $.slotIds.length; // 1-based
            slot.addedAt = uint64(block.timestamp);
        }
        slot.encryptedBlob = encryptedBlob;
        slot.encryptedMeta = encryptedMeta;
        slot.active = true;
        slot.version += 1;
        emit AccessSlotAdded(address(this), slotId, keccak256(encryptedBlob), slot.version);
    }

    function removeAccessSlot(bytes32 slotId) external {
        _authorizeSlotWrite();
        AccessVaultStorage storage $ = _vault();
        Slot storage slot = $.slots[slotId];
        if (!slot.active) revert AccessSlotMissing();

        // DESTROY THE CIPHERTEXT, do not merely flag it. Flipping `active` alone left the blob sitting
        // in storage AND still returned it from getAccessSlot — so a "removed" device could read its
        // own blob straight back out and decrypt it with the PRF it still holds. Removal then protected
        // against nothing at all, including the one case it is supposed to cover: a LOST device that
        // never extracted K. (Filtering on `active` in the client reader is not a security boundary;
        // the bytes were public.) Deleting also refunds the storage.
        //
        // `version` is NOT cleared: it is the monotonic rollback counter, and resetting it would let an
        // old blob reappear at a version an observer had already seen — precisely what it exists to
        // make visible.
        delete slot.encryptedBlob;
        delete slot.encryptedMeta;
        slot.active = false;

        // Swap-and-pop the slot out of the enumerable index (1-based; 0 means absent).
        uint256 oneBased = $.indexOfSlot[slotId];
        uint256 i = oneBased - 1;
        uint256 last = $.slotIds.length - 1;
        if (i != last) {
            bytes32 moved = $.slotIds[last];
            $.slotIds[i] = moved;
            $.indexOfSlot[moved] = oneBased; // the moved slot now sits where this one was
        }
        $.slotIds.pop();
        $.indexOfSlot[slotId] = 0;

        emit AccessSlotRemoved(address(this), slotId);
    }

    function getAccessSlot(bytes32 slotId)
        external
        view
        returns (bytes memory encryptedBlob, bool active, uint64 version, uint64 addedAt)
    {
        Slot storage slot = _vault().slots[slotId];
        return (slot.encryptedBlob, slot.active, slot.version, slot.addedAt);
    }

    function getAccessSlotMeta(bytes32 slotId) external view returns (bytes memory) {
        return _vault().slots[slotId].encryptedMeta;
    }

    function getAccessSlotIds() external view returns (bytes32[] memory) {
        return _vault().slotIds;
    }

    /// @dev The roster read: ids + metadata in one call, so a settings screen costs 1 request rather
    ///      than 1+N (33 at the cap). `getAccessSlot` stays lean for the login path, which never wants
    ///      metadata. Bounded by MAX_ACCESS_SLOTS, like the enumeration it mirrors.
    function getAccessSlots() external view returns (bytes32[] memory ids, bytes[] memory metas) {
        AccessVaultStorage storage $ = _vault();
        ids = $.slotIds;
        metas = new bytes[](ids.length);
        for (uint256 i = 0; i < ids.length; ++i) {
            metas[i] = $.slots[ids[i]].encryptedMeta;
        }
    }

    function accessSlotCount() external view returns (uint256) {
        return _vault().slotIds.length;
    }
}
