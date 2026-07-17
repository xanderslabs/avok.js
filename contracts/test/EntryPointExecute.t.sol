// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {BaseTest} from "./Base.t.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";
import {IPasskeyAccessVault} from "../src/interfaces/IPasskeyAccessVault.sol";

contract EPTarget {
    uint256 public lastValue;
    bytes public lastData;
    function poke(bytes calldata d) external payable { lastValue = msg.value; lastData = d; }
}

/// @notice After validation the EntryPoint forwards the UserOp's callData — the standard
/// ERC-7821 `execute(MODE_BATCH, executionData)` — to the account. So the batch gate must
/// accept the EntryPoint as well as a self-call.
contract EntryPointExecuteTest is BaseTest {
    bytes32 constant MODE_BATCH = 0x0100000000000000000000000000000000000000000000000000000000000000;
    address internal constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    EPTarget target;

    function setUp() public override { super.setUp(); target = new EPTarget(); }

    function _calls() internal view returns (AvokWalletImplementation.Call[] memory c) {
        c = new AvokWalletImplementation.Call[](1);
        c[0] = AvokWalletImplementation.Call(address(target), 1 ether, abi.encodeCall(EPTarget.poke, (hex"beef")));
    }

    function test_entryPoint_executesBatch() public {
        vm.prank(ENTRY_POINT);
        w().execute(MODE_BATCH, abi.encode(_calls()));
        assertEq(target.lastValue(), 1 ether);
        assertEq(target.lastData(), hex"beef");
    }

    function test_selfCall_stillExecutesBatch() public {
        vm.prank(wallet);
        w().execute(MODE_BATCH, abi.encode(_calls()));
        assertEq(target.lastValue(), 1 ether);
    }

    function test_stranger_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(IPasskeyAccessVault.Unauthorized.selector);
        w().execute(MODE_BATCH, abi.encode(_calls()));
    }
}
