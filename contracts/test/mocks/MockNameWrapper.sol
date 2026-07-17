// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {INameWrapper} from "../../src/interfaces/INameWrapper.sol";

contract MockNameWrapper is INameWrapper {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public resolvers;
    mapping(uint256 => uint64) public expiries; // records the expiry the registrar minted with

    function setSubnodeOwner(bytes32 parentNode, string calldata label, address owner, uint32, uint64 expiry)
        external
        returns (bytes32 node)
    {
        node = keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
        owners[uint256(node)] = owner;
        expiries[uint256(node)] = expiry;
    }

    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64,
        uint32,
        uint64 expiry
    ) external returns (bytes32 node) {
        node = keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
        owners[uint256(node)] = owner;
        resolvers[uint256(node)] = resolver;
        expiries[uint256(node)] = expiry;
    }

    function ownerOf(uint256 id) external view returns (address) {
        return owners[id];
    }
}
