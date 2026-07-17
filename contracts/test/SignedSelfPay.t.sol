// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {BaseTest} from "./Base.t.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

contract Sink { function ok() external payable {} }

contract SignedSelfPayTest is BaseTest {
    bytes32 constant MODE_BATCH_OPDATA = 0x0100000000007821000100000000000000000000000000000000000000000000;
    Sink sink;

    function setUp() public override { super.setUp(); sink = new Sink(); }

    function _oneCall() internal view returns (AvokWalletImplementation.Call[] memory c) {
        c = new AvokWalletImplementation.Call[](1);
        c[0] = AvokWalletImplementation.Call(address(sink), 0, abi.encodeCall(Sink.ok, ()));
    }

    function _exec(AvokWalletImplementation.Call[] memory c, uint256 nonce, uint256 deadline) internal {
        bytes32 digest = w().hashExecuteBatch(c, nonce, deadline);
        bytes memory sig = signDigest(digest);
        bytes memory opData = abi.encode(nonce, deadline, sig);
        vm.prank(address(0x5151)); // a relayer, NOT self
        w().execute(MODE_BATCH_OPDATA, abi.encode(c, opData));
    }

    function test_validSignedBatch_executes() public {
        _exec(_oneCall(), 1, block.timestamp + 1 hours);
        assertTrue(w().nonceUsed(1));
    }

    function test_expired_reverts() public {
        AvokWalletImplementation.Call[] memory c = _oneCall();
        bytes32 digest = w().hashExecuteBatch(c, 1, block.timestamp - 1);
        bytes memory opData = abi.encode(uint256(1), block.timestamp - 1, signDigest(digest));
        vm.expectRevert(AvokWalletImplementation.Expired.selector);
        w().execute(MODE_BATCH_OPDATA, abi.encode(c, opData));
    }

    function test_reusedNonce_reverts() public {
        _exec(_oneCall(), 7, block.timestamp + 1 hours);
        AvokWalletImplementation.Call[] memory c = _oneCall();
        bytes32 digest = w().hashExecuteBatch(c, 7, block.timestamp + 1 hours);
        bytes memory opData = abi.encode(uint256(7), block.timestamp + 1 hours, signDigest(digest));
        vm.expectRevert(AvokWalletImplementation.NonceUsed.selector);
        w().execute(MODE_BATCH_OPDATA, abi.encode(c, opData));
    }

    function test_bitmap_packsUpTo256NoncesPerWord() public {
        uint256 dl = block.timestamp + 1 hours;
        // nonces 0, 1, 255 all live in word 0 → a SINGLE storage slot holds all three bits (the
        // L1 density win: clustered nonces share one word instead of one cold slot each).
        _exec(_oneCall(), 0, dl);
        _exec(_oneCall(), 1, dl);
        _exec(_oneCall(), 255, dl);
        assertEq(w().nonceBitmap(0), (uint256(1) << 0) | (uint256(1) << 1) | (uint256(1) << 255));
        // nonce 256 rolls into word 1, bit 0.
        _exec(_oneCall(), 256, dl);
        assertEq(w().nonceBitmap(1), uint256(1) << 0);
    }

    function test_bitmap_eachBitIsSingleUse_evenSharingAWord() public {
        uint256 dl = block.timestamp + 1 hours;
        _exec(_oneCall(), 0, dl);
        _exec(_oneCall(), 1, dl); // same word as nonce 0, different bit — independently valid
        assertTrue(w().nonceUsed(0));
        assertTrue(w().nonceUsed(1));
        // reusing bit 1 reverts even though bit 0 in the same word is also set (no false collision).
        AvokWalletImplementation.Call[] memory c = _oneCall();
        bytes memory opData = abi.encode(uint256(1), dl, signDigest(w().hashExecuteBatch(c, 1, dl)));
        vm.expectRevert(AvokWalletImplementation.NonceUsed.selector);
        w().execute(MODE_BATCH_OPDATA, abi.encode(c, opData));
    }

    function test_tamperedCall_reverts() public {
        AvokWalletImplementation.Call[] memory c = _oneCall();
        bytes32 digest = w().hashExecuteBatch(c, 2, block.timestamp + 1 hours);
        bytes memory sig = signDigest(digest);
        c[0].value = 1 ether; // tamper AFTER signing
        bytes memory opData = abi.encode(uint256(2), block.timestamp + 1 hours, sig);
        vm.expectRevert(AvokWalletImplementation.InvalidSignature.selector);
        w().execute(MODE_BATCH_OPDATA, abi.encode(c, opData));
    }

    function test_highS_reverts() public {
        AvokWalletImplementation.Call[] memory c = _oneCall();
        bytes32 digest = w().hashExecuteBatch(c, 3, block.timestamp + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, digest);
        // flip s to its high-malleable complement and v accordingly
        bytes32 highS = bytes32(uint256(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141) - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory sig = abi.encodePacked(r, highS, flippedV);
        bytes memory opData = abi.encode(uint256(3), block.timestamp + 1 hours, sig);
        vm.expectRevert(AvokWalletImplementation.InvalidSignature.selector);
        w().execute(MODE_BATCH_OPDATA, abi.encode(c, opData));
    }
}
