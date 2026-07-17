// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {BaseTest} from "./Base.t.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract Erc1271ReceiversTest is BaseTest {
    function test_isValidSignature_validForWalletSig() public view {
        bytes32 hash = keccak256("hello");
        bytes memory sig = signDigest(hash);
        assertEq(w().isValidSignature(hash, sig), IERC1271.isValidSignature.selector);
    }

    function test_isValidSignature_invalidForStranger() public view {
        bytes32 hash = keccak256("hello");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        assertEq(w().isValidSignature(hash, sig), bytes4(0xffffffff));
    }

    function test_onERC721Received_returnsSelector() public {
        assertEq(
            w().onERC721Received(address(0), address(0), 0, ""),
            IERC721Receiver.onERC721Received.selector
        );
    }

    function test_supportsInterface() public view {
        assertTrue(w().supportsInterface(type(IERC1271).interfaceId));
        assertTrue(w().supportsInterface(type(IERC721Receiver).interfaceId));
    }
}
