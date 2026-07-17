// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {BaseTest} from "./Base.t.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

contract SLSink { function ok() external payable {} }

/// @notice Anti-drift guard for Cross-Cutting Invariant #2/#3: the dual-mode 4337 additions
/// (`validateUserOp`, the EntryPoint-gated execute) are STATELESS — they add no storage. So the
/// append-only layout is unchanged: `nonceBitmap` still occupies declared slot 0, and the vault's
/// ERC-7201 root is still the frozen `0xa4fa…0600`. If either assertion fails, a storage variable
/// was added/moved — revert the change (do not update the expectation).
contract StorageLayoutTest is BaseTest {
    bytes32 constant MODE_BATCH_OPDATA = 0x0100000000007821000100000000000000000000000000000000000000000000;
    bytes32 constant FROZEN_ERC7201_ROOT =
        0xa4fa4294098059eabd10052f01eef3d8d7de7be8acc14248ecb1c1794a130600;
    SLSink sink;

    function setUp() public override { super.setUp(); sink = new SLSink(); }

    function test_erc7201Root_frozen() public view {
        assertEq(w().accessVaultStorageRoot(), FROZEN_ERC7201_ROOT, "ERC-7201 vault root drifted");
    }

    function test_nonceBitmap_atDeclaredSlot0() public {
        // Consume nonce 0 (word 0, bit 0) via the signed self-pay path.
        AvokWalletImplementation.Call[] memory c = new AvokWalletImplementation.Call[](1);
        c[0] = AvokWalletImplementation.Call(address(sink), 0, abi.encodeCall(SLSink.ok, ()));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = w().hashExecuteBatch(c, 0, deadline);
        bytes memory opData = abi.encode(uint256(0), deadline, signDigest(digest));
        vm.prank(address(0x5151));
        w().execute(MODE_BATCH_OPDATA, abi.encode(c, opData));

        // nonceBitmap is `mapping(uint256 word => uint256 bitmap)` at declared slot 0.
        // The word-0 bucket therefore lives at keccak256(abi.encode(word, slot)) with slot == 0.
        bytes32 wordSlot = keccak256(abi.encode(uint256(0), uint256(0)));
        assertEq(uint256(vm.load(wallet, wordSlot)), uint256(1), "nonceBitmap not at declared slot 0");
    }
}
