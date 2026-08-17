// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {GuardianLogic} from "../src/GuardianLogic.sol";
import {AvokCalibur} from "../src/AvokCalibur.sol";

/// @notice Deterministic CREATE2 deploy of the canonical GuardianLogic + AvokCalibur pair.
///
/// FUND-CRITICAL. Every Avok wallet delegates (EIP-7702) to canonicalAvokCalibur. Two CREATE2
/// deploys, in order: GuardianLogic first (no constructor, so its creation bytecode is fixed),
/// then AvokCalibur, whose constructor takes GuardianLogic's own address. Because GuardianLogic's
/// address is itself deterministic (fixed salt, fixed bytecode, the same deployer on every
/// chain), AvokCalibur's creation bytecode — constructor argument included — is equally fixed
/// across chains, so its CREATE2 address is too.
contract DeployCanonical is Script {
    /// @dev Standard cross-chain CREATE2 deployer (Arachnid deterministic-deployment-proxy).
    /// Deployed at this same address on essentially every EVM chain, incl. Arc. A forge
    /// broadcast routes `new X{salt}()` through this deployer, giving a chain-uniform address.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev FIXED canonical salts. CHANGING EITHER CHANGES THE corresponding ADDRESS ON EVERY
    /// EVM CHAIN — never modify once deployed to a chain anyone relies on.
    bytes32 internal constant GUARDIAN_LOGIC_SALT = keccak256("avok.guardianlogic.canonical");
    bytes32 internal constant AVOK_CALIBUR_SALT = keccak256("avok.calibur.canonical");

    function run() external returns (GuardianLogic guardianLogic, AvokCalibur avokCalibur) {
        bytes32 guardianLogicInitCodeHash = keccak256(type(GuardianLogic).creationCode);
        address predictedGuardianLogic =
            vm.computeCreate2Address(GUARDIAN_LOGIC_SALT, guardianLogicInitCodeHash, CREATE2_DEPLOYER);

        bytes32 avokCaliburInitCodeHash =
            keccak256(abi.encodePacked(type(AvokCalibur).creationCode, abi.encode(predictedGuardianLogic)));
        address predictedAvokCalibur =
            vm.computeCreate2Address(AVOK_CALIBUR_SALT, avokCaliburInitCodeHash, CREATE2_DEPLOYER);

        vm.startBroadcast();
        guardianLogic = new GuardianLogic{salt: GUARDIAN_LOGIC_SALT}();
        avokCalibur = new AvokCalibur{salt: AVOK_CALIBUR_SALT}(address(guardianLogic));
        vm.stopBroadcast();

        console2.log("Predicted GuardianLogic:", predictedGuardianLogic);
        console2.log("Deployed  GuardianLogic:", address(guardianLogic));
        console2.log("Predicted AvokCalibur:", predictedAvokCalibur);
        console2.log("Deployed  AvokCalibur:", address(avokCalibur));

        // Fail loud if the toolchain ever deviates from the CREATE2 prediction.
        require(address(guardianLogic) == predictedGuardianLogic, "DeployCanonical: GuardianLogic != prediction");
        require(address(avokCalibur) == predictedAvokCalibur, "DeployCanonical: AvokCalibur != prediction");
    }
}
