// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Minimal ENS resolver surface for writing the forward `addr` record.
interface IAddrResolver {
    function setAddr(bytes32 node, address a) external;

    function addr(bytes32 node) external view returns (address payable);
}
