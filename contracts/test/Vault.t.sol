// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Vm} from "forge-std/Vm.sol";
import {BaseTest} from "./Base.t.sol";
import {IPasskeyAccessVault} from "../src/interfaces/IPasskeyAccessVault.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

contract VaultTest is BaseTest {
    bytes32 constant SLOT_A = keccak256("credA");
    bytes32 constant SLOT_B = keccak256("credB");

    /// Opaque per-slot metadata ciphertext. The contract never interprets it — its shape is the
    /// SDK's business (an encrypted rp-id), so a stand-in of arbitrary bytes is the honest fixture.
    bytes constant META = hex"00112233";

    /// The canonical envelope: version(1) || iv(12) || ciphertext(48).
    function _blob(uint8 fill) internal pure returns (bytes memory b) {
        b = new bytes(61);
        b[0] = bytes1(fill);
    }

    function test_addAccessSlot_stores_and_counts() public {
        vm.prank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        (bytes memory blob, bool active, uint64 version,) = w().getAccessSlot(SLOT_A);
        assertEq(blob.length, 61);
        assertEq(uint8(blob[0]), 1);
        assertTrue(active);
        assertEq(version, 1, "first write is version 1");
        assertEq(w().accessSlotCount(), 1);
    }

    /// slotId MUST NOT be an indexed topic. Indexed topics are cheaply filterable, which would let
    /// anyone holding a slot id walk backwards to the wallet that owns it. `wallet` stays indexed —
    /// an owner reading their own events is the legitimate query.
    function test_AccessSlotAdded_does_not_index_the_slotId() public {
        vm.recordLogs();
        vm.prank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one AccessSlotAdded");
        // topics[0] = event signature, topics[1] = wallet. Nothing else may be a topic.
        assertEq(logs[0].topics.length, 2, "only the event sig and `wallet` may be topics");
        assertEq(address(uint160(uint256(logs[0].topics[1]))), wallet);
    }

    function test_rewrite_bumps_version_monotonically() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().addAccessSlot(SLOT_A, _blob(2), META); // overwrite the same slot
        vm.stopPrank();
        (bytes memory blob, bool active, uint64 version,) = w().getAccessSlot(SLOT_A);
        assertEq(uint8(blob[0]), 2, "the newer blob wins");
        assertTrue(active);
        assertEq(version, 2, "rewrite bumps the version");
        assertEq(w().accessSlotCount(), 1, "rewrite does not double-count");
    }

    function test_removeAccessSlot_deactivates() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().removeAccessSlot(SLOT_A);
        vm.stopPrank();
        (, bool active,,) = w().getAccessSlot(SLOT_A);
        assertFalse(active);
        assertEq(w().accessSlotCount(), 0);
    }

    /// The version counter exists for rollback detection, so it must NOT reset when a slot is
    /// removed and re-added — if it restarted at 1, an old blob could reappear at a version an
    /// observer had already seen, which is exactly what the counter is there to make visible.
    /// (Removal is not a blob write, so it does not itself bump the counter: 1 -> remove -> 2.)
    function test_version_never_resets_across_remove_and_readd() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().removeAccessSlot(SLOT_A);
        w().addAccessSlot(SLOT_A, _blob(3), META); // re-activate
        vm.stopPrank();
        (bytes memory blob, bool active, uint64 version,) = w().getAccessSlot(SLOT_A);
        assertTrue(active);
        assertEq(uint8(blob[0]), 3);
        assertGt(version, 1, "the counter continues; it must never restart at 1");
        assertEq(version, 2, "each blob write bumps exactly once");
        assertEq(w().accessSlotCount(), 1, "re-activation is not double-counted");
    }

    function test_slots_are_independent() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().addAccessSlot(SLOT_B, _blob(2), META);
        w().removeAccessSlot(SLOT_A);
        vm.stopPrank();
        (, bool activeB,,) = w().getAccessSlot(SLOT_B);
        assertTrue(activeB, "closing one access slot must not close another");
        assertEq(w().accessSlotCount(), 1);
    }

    /// The birth credential holds NO slot and derives K from its own PRF, so dropping the last
    /// access slot cannot orphan the wallet.
    function test_removeLastAccessSlot_succeeds_becauseBirthCredentialDerivesTheKey() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        assertEq(w().accessSlotCount(), 1);
        w().removeAccessSlot(SLOT_A);
        vm.stopPrank();
        assertEq(w().accessSlotCount(), 0);
        (, bool active,,) = w().getAccessSlot(SLOT_A);
        assertFalse(active);
    }

    /// REMOVAL MUST DESTROY THE CIPHERTEXT, and this is asserted against RAW STORAGE — not against the
    /// getter, because the getter is what lied. Before this was fixed, removeAccessSlot flipped
    /// `active` and left the 61 bytes in place: getAccessSlot still returned the whole blob, and a
    /// "removed" device could read it back and decrypt it with the PRF it still holds. Removal
    /// protected against nothing, including the one case it claims to cover (a LOST device that never
    /// extracted K). A client-side `if (!active) return null` is not a security boundary.
    function test_removal_destroys_the_ciphertext_in_raw_storage() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(0xAB), META);
        w().removeAccessSlot(SLOT_A);
        vm.stopPrank();

        bytes32 root = w().accessVaultStorageRoot();
        bytes32 entry = keccak256(abi.encode(SLOT_A, root)); // the Slot struct's base word
        assertEq(uint256(vm.load(wallet, entry)), 0, "the blob's length header must be gone");
        assertEq(
            vm.load(wallet, keccak256(abi.encode(entry))),
            bytes32(0),
            "the blob's first data word must be gone -- a removed device must not be able to read it back"
        );

        (bytes memory blob,,,) = w().getAccessSlot(SLOT_A);
        assertEq(blob.length, 0, "and the getter must not hand the ciphertext back either");
        assertEq(w().getAccessSlotMeta(SLOT_A).length, 0, "the access slot's metadata goes with it");
    }

    /// The rollback counter must SURVIVE removal — see test_version_never_resets_across_remove_and_readd.
    /// Deleting the blob must not take the version with it.
    function test_removal_destroys_the_blob_but_keeps_the_version() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().removeAccessSlot(SLOT_A);
        vm.stopPrank();
        (,, uint64 version,) = w().getAccessSlot(SLOT_A);
        assertEq(version, 1, "the monotonic version must not reset when the ciphertext is destroyed");
    }

    function test_removeMissing_reverts() public {
        vm.prank(wallet);
        vm.expectRevert(IPasskeyAccessVault.AccessSlotMissing.selector);
        w().removeAccessSlot(SLOT_A);
    }

    function test_only_self_may_write() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(IPasskeyAccessVault.Unauthorized.selector);
        w().addAccessSlot(SLOT_A, _blob(1), META);
    }

    function test_only_self_may_remove() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(IPasskeyAccessVault.Unauthorized.selector);
        w().removeAccessSlot(SLOT_A);
    }

    function test_rejects_empty_and_oversized_blobs() public {
        vm.startPrank(wallet);
        vm.expectRevert(IPasskeyAccessVault.EmptyBlob.selector);
        w().addAccessSlot(SLOT_A, "", META);
        vm.expectRevert(IPasskeyAccessVault.BlobTooLarge.selector);
        w().addAccessSlot(SLOT_A, new bytes(4097), META);
        vm.stopPrank();
    }

    /// The point of namespacing: the vault's storage root is derived from the namespace id alone,
    /// so it is identical in every conforming implementation regardless of what else they inherit.
    /// A wallet can therefore re-delegate to another vendor's implementation and keep its access slots.
    function test_storage_root_is_the_erc7201_namespace() public view {
        bytes32 expected =
            keccak256(abi.encode(uint256(keccak256("passkey-access-vault.main")) - 1)) & ~bytes32(uint256(0xff));
        assertEq(w().accessVaultStorageRoot(), expected);
    }

    /// ...and the vault must actually LIVE there, not merely report an address. Read the raw storage
    /// slot the mapping hashes into and confirm the blob is present at it.
    function test_vault_storage_actually_lives_at_the_namespace() public {
        vm.prank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);

        // `slots` is the first member of AccessVaultStorage, so its mapping base IS the root.
        bytes32 root = w().accessVaultStorageRoot();
        bytes32 entry = keccak256(abi.encode(SLOT_A, root));
        // Slot layout: word[0] = the `bytes encryptedBlob` header. For a >31-byte (long) bytes
        // value, that word holds (length * 2 + 1).
        uint256 header = uint256(vm.load(wallet, entry));
        assertEq(header, 61 * 2 + 1, "the 61-byte blob is stored at the namespaced slot");
    }

    function test_getAccessSlotIds_lists_active_slots() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().addAccessSlot(SLOT_B, _blob(2), META);
        vm.stopPrank();
        bytes32[] memory ids = w().getAccessSlotIds();
        assertEq(ids.length, 2);
        assertTrue((ids[0] == SLOT_A && ids[1] == SLOT_B) || (ids[0] == SLOT_B && ids[1] == SLOT_A));
    }

    function test_addedAt_is_set_on_first_write_and_survives_rewrite() public {
        vm.warp(1_700_000_000);
        vm.prank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        (,,, uint64 addedAt1) = w().getAccessSlot(SLOT_A);
        assertEq(addedAt1, 1_700_000_000, "addedAt records the first write's block time");

        vm.warp(1_700_009_999);
        vm.prank(wallet);
        w().addAccessSlot(SLOT_A, _blob(2), META); // rewrite, same access slot
        (,,, uint64 addedAt2) = w().getAccessSlot(SLOT_A);
        assertEq(addedAt2, 1_700_000_000, "a rewrite does not move the enrollment time");
    }

    function test_rewrite_does_not_duplicate_the_index_entry() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().addAccessSlot(SLOT_A, _blob(2), META); // same slot again
        vm.stopPrank();
        assertEq(w().getAccessSlotIds().length, 1, "a rewrite is not a new access slot");
    }

    function test_remove_drops_the_slot_from_the_index() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().addAccessSlot(SLOT_B, _blob(2), META);
        w().removeAccessSlot(SLOT_A);
        vm.stopPrank();
        bytes32[] memory ids = w().getAccessSlotIds();
        assertEq(ids.length, 1);
        assertEq(ids[0], SLOT_B, "swap-and-pop must leave the surviving slot reachable");
    }

    function test_readd_after_remove_reappears_once_with_a_fresh_timestamp() public {
        vm.warp(1_700_000_000);
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        w().removeAccessSlot(SLOT_A);
        vm.warp(1_700_050_000);
        w().addAccessSlot(SLOT_A, _blob(3), META);
        vm.stopPrank();
        assertEq(w().getAccessSlotIds().length, 1, "re-added exactly once, not zero and not twice");
        assertEq(w().getAccessSlotIds()[0], SLOT_A);
        (,,, uint64 addedAt) = w().getAccessSlot(SLOT_A);
        assertEq(addedAt, 1_700_050_000, "re-adding is a new enrollment, so a fresh timestamp");
    }

    function test_addAccessSlot_stores_and_returns_meta() public {
        vm.prank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), META);
        assertEq(w().getAccessSlotMeta(SLOT_A), META);
    }

    /// An access slot with no metadata is legal: the enroller may not know its rp-id (or may decline to
    /// record one), and that must not block the write.
    function test_empty_meta_is_allowed() public {
        vm.prank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), "");
        assertEq(w().getAccessSlotMeta(SLOT_A).length, 0, "an access slot with no metadata is legal");
    }

    function test_rejects_oversized_meta() public {
        vm.prank(wallet);
        vm.expectRevert(IPasskeyAccessVault.MetaTooLarge.selector);
        w().addAccessSlot(SLOT_A, _blob(1), new bytes(257));
    }

    function test_rewrite_updates_meta() public {
        vm.startPrank(wallet);
        w().addAccessSlot(SLOT_A, _blob(1), hex"aa");
        w().addAccessSlot(SLOT_A, _blob(2), hex"bb");
        vm.stopPrank();
        assertEq(w().getAccessSlotMeta(SLOT_A), hex"bb", "a rewrite updates the metadata too");
    }

    /// An unbounded array in account storage is a griefing vector and makes removal's swap-and-pop
    /// unbounded. 32 access slots is far past any real wallet.
    function test_rejects_more_than_MAX_ACCESS_SLOTS() public {
        vm.startPrank(wallet);
        for (uint256 i = 0; i < 32; i++) {
            w().addAccessSlot(bytes32(uint256(0x1000 + i)), _blob(1), META);
        }
        vm.expectRevert(IPasskeyAccessVault.TooManyAccessSlots.selector);
        w().addAccessSlot(bytes32(uint256(0x9999)), _blob(1), META);
        vm.stopPrank();
        assertEq(w().accessSlotCount(), 32);
    }
}
