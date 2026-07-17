// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script} from "forge-std/Script.sol";
import {AvokSubnameRegistrar} from "../src/AvokSubnameRegistrar.sol";
import {INameWrapper} from "../src/interfaces/INameWrapper.sol";

/// @notice Deploy an operator's AvokSubnameRegistrar. Env:
///   NAME_WRAPPER, PARENT_NODE (bytes32 namehash of the parent), VOUCHER_SIGNER,
///   RESOLVER (ENS public resolver — sets the forward addr record on mint),
///   OPEN_CLAIM (0/1), FUSES (uint32, default 0).
/// Subnames are minted at max expiry (clamped to the parent's) — no NAME_EXPIRY knob, so
/// subnames never lapse into re-claimability. After deploy, the parent owner must
/// approve/delegate this registrar on the NameWrapper.
contract DeployAvokSubnameRegistrar is Script {
    function run() external returns (AvokSubnameRegistrar registrar) {
        address nameWrapper = vm.envAddress("NAME_WRAPPER");
        bytes32 parentNode = vm.envBytes32("PARENT_NODE");
        address voucherSigner = vm.envAddress("VOUCHER_SIGNER");
        address resolver = vm.envAddress("RESOLVER");
        bool openClaim = vm.envOr("OPEN_CLAIM", uint256(0)) == 1;
        uint32 fuses = uint32(vm.envOr("FUSES", uint256(0)));
        address initialOwner = vm.envOr("OWNER", msg.sender);

        vm.startBroadcast();
        registrar = new AvokSubnameRegistrar(
            INameWrapper(nameWrapper), parentNode, voucherSigner, resolver, openClaim, fuses, initialOwner
        );
        vm.stopBroadcast();
    }
}
