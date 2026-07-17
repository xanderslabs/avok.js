// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

contract Eip712ParityTest is Test {
    address constant W = 0x00000000000000000000000000000000000000A1;
    bytes32 constant EXPECTED_EXECUTE   = 0x165f68a685fac273e4fd50a93146c9546ce6c035866731864e63d37b7d93be40;

    function setUp() public {
        vm.chainId(8453);
        vm.etch(W, address(new AvokWalletImplementation()).code);
    }

    function _user() internal pure returns (AvokWalletImplementation.Call[] memory c) {
        c = new AvokWalletImplementation.Call[](1);
        c[0] = AvokWalletImplementation.Call(0x0000000000000000000000000000000000000003, 1, hex"abcd");
    }

    function test_executeBatchDigest_matchesTs() public view {
        assertEq(AvokWalletImplementation(payable(W)).hashExecuteBatch(_user(), 1, 1000000), EXPECTED_EXECUTE);
    }
}
