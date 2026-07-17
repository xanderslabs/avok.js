// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {BaseTest} from "./Base.t.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";
import {IPasskeyAccessVault} from "../src/interfaces/IPasskeyAccessVault.sol";

contract Target {
    uint256 public lastValue;
    bytes public lastData;
    function poke(bytes calldata d) external payable { lastValue = msg.value; lastData = d; }
}

contract SelfPay7821Test is BaseTest {
    bytes32 constant MODE_BATCH = 0x0100000000000000000000000000000000000000000000000000000000000000;
    bytes32 constant MODE_BATCH_OPDATA = 0x0100000000007821000100000000000000000000000000000000000000000000;
    Target target;

    function setUp() public override { super.setUp(); target = new Target(); }

    function _calls() internal view returns (AvokWalletImplementation.Call[] memory c) {
        c = new AvokWalletImplementation.Call[](1);
        c[0] = AvokWalletImplementation.Call(address(target), 1 ether, abi.encodeCall(Target.poke, (hex"beef")));
    }

    function test_selfCall_executesBatch_forwardingValue() public {
        vm.prank(wallet); // msg.sender == address(this)
        w().execute(MODE_BATCH, abi.encode(_calls()));
        assertEq(target.lastValue(), 1 ether);
        assertEq(target.lastData(), hex"beef");
    }

    function test_nonSelfCaller_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(IPasskeyAccessVault.Unauthorized.selector);
        w().execute(MODE_BATCH, abi.encode(_calls()));
    }

    function test_unsupportedMode_reverts() public {
        vm.prank(wallet);
        vm.expectRevert(AvokWalletImplementation.UnsupportedExecutionMode.selector);
        w().execute(bytes32(0), abi.encode(_calls()));
    }

    function test_supportsExecutionMode() public view {
        assertTrue(w().supportsExecutionMode(MODE_BATCH));
        assertTrue(w().supportsExecutionMode(MODE_BATCH_OPDATA));
        assertFalse(w().supportsExecutionMode(bytes32(0)));
    }
}
