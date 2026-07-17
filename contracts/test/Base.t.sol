// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

/// @notice Etches the implementation runtime code at an EOA address so that
/// `address(this) == wallet` and signatures by `eoaPk` recover to the wallet —
/// the EIP-7702 delegated-account condition.
contract BaseTest is Test {
    uint256 internal constant eoaPk = 0xA11CE;
    address internal wallet;

    function setUp() public virtual {
        AvokWalletImplementation impl = new AvokWalletImplementation();
        wallet = vm.addr(eoaPk);
        vm.etch(wallet, address(impl).code);
        vm.deal(wallet, 100 ether);
    }

    function signDigest(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoaPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function w() internal view returns (AvokWalletImplementation) {
        return AvokWalletImplementation(payable(wallet));
    }
}
