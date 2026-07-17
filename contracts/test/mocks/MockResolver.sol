// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {IAddrResolver} from "../../src/interfaces/IAddrResolver.sol";

contract MockResolver is IAddrResolver {
    mapping(bytes32 => address) public addrs;

    function setAddr(bytes32 node, address a) external {
        addrs[node] = a;
    }

    function addr(bytes32 node) external view returns (address payable) {
        return payable(addrs[node]);
    }
}
