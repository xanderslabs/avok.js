// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {BaseTest} from "./Base.t.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

/// Measures the access-slot write envelope, so the binary-vs-JSON saving is a measured number and
/// not a guess. (The old fronted-envelope measurement retired with the bespoke `executeFronted`
/// path — the 4337 bundler now estimates fronted gas.)
contract GasMeasureTest is BaseTest {
    /// The canonical 61-byte envelope is the reason the standard forbids JSON. This measures BOTH
    /// envelope sizes against the SAME contract, so the delta is attributable to the encoding alone
    /// and to nothing else.
    ///
    /// A `bytes` value costs one cold SSTORE for its length word plus one per 32-byte data word, so
    /// the saving is driven by word count: 61 bytes = 2 data words, 156 bytes (the old JSON
    /// envelope) = 5. Pinned so a future "let's just add one more field" has to argue with a failing
    /// test rather than quietly cost every user gas on every access-slot write.
    /// MEASUREMENT HAZARD, learned the hard way: each envelope must be measured from a COLD state.
    /// Two writes in one context make the second look ~15k cheaper than the first regardless of size,
    /// because the first warms the account (EIP-2929). Measured that way the 156-byte JSON envelope
    /// appears CHEAPER than the 61-byte binary one — the exact opposite of the truth.
    /// Two ways to get a cold state, both used below: a separate test (foundry re-runs setUp per
    /// test), or vm.snapshotState/revertToState around each write within one test.
    /// SECOND MEASUREMENT HAZARD: the blob MUST be non-zero. `new bytes(n)` is all zeros, and an
    /// SSTORE writing zero over zero costs ~2,200 gas instead of ~22,100 — so a zero-filled blob is
    /// nearly free to store and the measurement collapses to noise. Real ciphertext is
    /// indistinguishable from random, so every word is non-zero. Fill it.
    /// THIRD MEASUREMENT NOTE: the write now also carries the per-slot metadata ciphertext, and the
    /// real one is 93 bytes (version(1) || iv(12) || ct(64+16)). Both envelopes are measured carrying
    /// that same real metadata, so the binary-vs-JSON delta stays attributable to the blob encoding
    /// alone while the absolute pin reflects what a user actually pays.
    function _measureSlotWrite(uint256 blobLen) internal returns (uint256 used) {
        bytes memory blob = _nonZero(blobLen);
        bytes memory meta = _nonZero(93);
        vm.prank(wallet);
        uint256 g0 = gasleft();
        w().addAccessSlot(bytes32(uint256(1)), blob, meta);
        used = g0 - gasleft();
    }

    function _nonZero(uint256 len) private pure returns (bytes memory b) {
        b = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            b[i] = bytes1(uint8(0xA0 + (i % 0x50))); // non-zero, like real ciphertext
        }
    }

    /// The canonical 61-byte envelope (version(1) || iv(12) || ciphertext(48)) is why the standard
    /// forbids JSON. A `bytes` value costs one cold SSTORE for its length word plus one per 32-byte
    /// data word, so the saving is driven by word count: 61 bytes = 2 data words vs 156 = 5.
    ///
    /// MEASURED (cold, non-zero ciphertext, this contract, first write to a NEW access slot, carrying the
    /// real 93-byte per-slot metadata ciphertext):
    ///   61-byte binary : 249,806 gas
    ///   156-byte JSON  : 316,465 gas
    ///   saving         :  66,659 gas per access-slot write
    ///
    /// Both fell ~22.2k from 272,020 / 338,665 when the redundant `activeCount` was dropped — one
    /// cold SSTORE per new slot, on every write, for a number `slotIds.length` already knew. The
    /// SAVING did not move (66,645 → 66,659, noise), because both envelopes paid that cost equally:
    /// exactly what this test exists to keep honest.
    ///
    /// The absolute cost includes the per-slot metadata: 93 bytes = one length word + 3 data words of
    /// cold SSTORE. That is the price of the roster being able to say WHICH DOMAIN enrolled each access
    /// slot — paid once per access slot, and the only alternative was a plaintext rp-id on chain,
    /// which is the thing this must not do.
    ///
    /// The absolute cost rose from an earlier ~115k because a first write is now a NEW-ACCESS-SLOT write: it
    /// also maintains the enumerable index (an array push + a 1-based index mapping + addedAt). That
    /// ~67k is the fixed price of being able to list and aim removals at access slots — paid once per access slot,
    /// never on a rewrite. The ENCODING saving (~66.6k) is unchanged, because JSON pays that same
    /// index cost too; the binary win is orthogonal to it.
    ///
    /// Pinned so a future "let's just add one more field" argues with a failing test instead of
    /// quietly taxing every access-slot write.
    function test_measure_addAccessSlot_binary_envelope() public {
        uint256 used = _measureSlotWrite(61);
        emit log_named_uint("addAccessSlot gas: 61-byte binary envelope (cold, new access slot)", used);
        assertLt(used, 280_000, "a cold new-access-slot write must stay under 280k gas");
    }

    /// The counterfactual: the same contract, the same code path, only the envelope is the old
    /// 156-byte JSON one. The delta against the binary write is attributable to the encoding alone.
    ///
    /// BOTH SIDES ARE MEASURED HERE, each from a COLD state.
    ///
    /// They used to be a live JSON measurement compared against a hardcoded
    /// `_BINARY_ENVELOPE_GAS = 272_020`. That constant was not sloppiness — it existed because
    /// measuring both in sequence WARMS the account, so the second write comes out cheaper regardless
    /// of its size, and the comparison inverts. But a hardcoded baseline goes stale the moment the
    /// write path changes for any unrelated reason: dropping the redundant `activeCount` SSTORE made
    /// BOTH envelopes ~22k cheaper, the live JSON side followed, the constant did not, and the test
    /// reported the saving had collapsed to 44k when it had not moved at all.
    ///
    /// A snapshot gives each measurement its own cold state, so the delta is attributable to the
    /// encoding alone AND nothing has to be re-typed when the write path changes.
    function test_measure_addAccessSlot_json_envelope_counterfactual() public {
        uint256 snap = vm.snapshotState();
        uint256 binary = _measureSlotWrite(61);
        vm.revertToState(snap);
        uint256 used = _measureSlotWrite(156);
        emit log_named_uint("addAccessSlot gas: 61-byte binary envelope (cold, new access slot)", binary);
        emit log_named_uint("addAccessSlot gas: 156-byte JSON envelope (cold, new access slot)", used);
        emit log_named_uint("encoding saving (JSON - binary)", used - binary);
        assertGt(used, binary, "the JSON envelope really is the expensive one");
        assertGt(used - binary, 50_000, "binary must save at least 50k gas per write");
    }

    /// Design 5 rests on a load-bearing claim that was NEVER MEASURED: that batching the access-slot write
    /// into a transaction the user was ALREADY sending costs only its marginal gas ("~40k"). The whole
    /// write-on-first-value resolution depends on that being cheap. Measure it.
    ///
    /// The marginal case = a write to an account that is already warm (the user's own transaction has
    /// touched it) and whose shared counters are already warm. That is exactly a second write in the
    /// same transaction, which is what batching does.
    function test_measure_marginal_cost_of_batching_the_access_slot_write() public {
        bytes memory blob = _nonZero(61);
        bytes memory meta = _nonZero(93);

        vm.startPrank(wallet);
        uint256 g0 = gasleft();
        w().addAccessSlot(bytes32(uint256(0xAAA)), blob, meta);
        uint256 coldSlot = g0 - gasleft();

        uint256 g1 = gasleft();
        w().addAccessSlot(bytes32(uint256(0xBBB)), blob, meta);
        uint256 marginalSlot = g1 - gasleft();
        vm.stopPrank();

        emit log_named_uint("access-slot write: COLD account (first access slot, standalone tx)", coldSlot);
        emit log_named_uint("access-slot write: WARM account (marginal -- the batching case)", marginalSlot);
        assertLt(marginalSlot, coldSlot, "a warm write must be cheaper than a cold one");
    }

}
