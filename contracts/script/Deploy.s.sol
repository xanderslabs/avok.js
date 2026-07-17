// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script} from "forge-std/Script.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

/// @notice Deploys the canonical AvokWalletImplementation. Wallets delegate to
/// the deployed address via EIP-7702; the contract has no constructor state.
contract DeployAvokWallet is Script {
    function run() external returns (AvokWalletImplementation implementation) {
        vm.startBroadcast();
        implementation = new AvokWalletImplementation();
        vm.stopBroadcast();
    }
}
