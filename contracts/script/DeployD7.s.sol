// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {OidcRecoveryGuardian} from "../src/OidcRecoveryGuardian.sol";
import {IUltraHonkVerifier} from "../src/interfaces/IUltraHonkVerifier.sol";
import {GuardianLogic} from "../src/GuardianLogic.sol";
import {IGuardianLogic} from "../src/interfaces/IGuardianLogic.sol";
import {GuardianHost} from "../test/mocks/GuardianHost.sol";

/// @notice D7 sprint labeled-experiment deploy: KeyRegistry + OidcRecoveryGuardian, wired to a
///         demo wallet, for the testnet upgrade from local-net to public Base Sepolia. NOT the
///         canonical production deploy path (that's DeployCanonical.s.sol / AvokCalibur) — this
///         is scoped to closing the D7 recovery loop for real, per
///         .superpowers/plans/2026-08-17-d7-keyregistry-sprint.md's gate outcome (labeled
///         experiment, real UltraHonk verifier + public deploy were the explicit remaining work).
///
///         GuardianHost stands in for AvokCalibur here deliberately — it's the same delegatecall
///         stand-in the whole guardian test suite already exercises GuardianLogic through (see
///         its own doc comment), not a new demo-only shortcut. GuardianLogic itself is the real,
///         audited, Slither-clean contract; nothing about the recovery logic being exercised here
///         is a stand-in.
///
///         The verifier is deployed separately, from circuits/jwt-recovery/verifier's own Foundry
///         project (see that project's foundry.toml for why: solc's Yul optimizer can't handle
///         bb's generated code under this project's via_ir/prague/200-runs settings), and its
///         address is passed in via VERIFIER_ADDRESS.
///
///         Attestor roster and quorum: this prototype's KeyRegistry spec explicitly leaves the
///         real roster/quorum as a founder/ops decision (see
///         .superpowers/specs/2026-08-18-keyregistry-spec.md). This deploy uses a single
///         attestor (the deployer) at quorum=1 because that's the only funded key available for
///         this run — a live-but-minimal config, not a production recommendation. Real deploys
///         need a genuinely independent multi-attestor roster before the registry means anything
///         security-wise.
///
///         Usage:
///           OWNER_AND_ATTESTOR=0x... VERIFIER_ADDRESS=0x... \
///             forge script script/DeployD7.s.sol --rpc-url https://sepolia.base.org \
///             --private-key $DEPLOYER_KEY --broadcast
contract DeployD7 is Script {
    // Matches GuardianLogic's own MIN_DELAY — the contract enforces this floor, so the demo
    // config is exactly as fast as the real one is allowed to ever be, not faster.
    uint40 internal constant RECOVERY_DELAY = 1 hours;
    uint40 internal constant GUARDIAN_OP_DELAY = 1 hours;

    function run()
        external
        returns (
            KeyRegistry registry,
            OidcRecoveryGuardian oidc,
            GuardianLogic logic,
            GuardianHost wallet
        )
    {
        address ownerAndAttestor = vm.envAddress("OWNER_AND_ATTESTOR");
        address verifierAddress = vm.envAddress("VERIFIER_ADDRESS");

        address[] memory attestors = new address[](1);
        attestors[0] = ownerAndAttestor;

        vm.startBroadcast();

        registry = new KeyRegistry(ownerAndAttestor, attestors, 1, 5 minutes, 1 days);
        oidc = new OidcRecoveryGuardian(registry, IUltraHonkVerifier(verifierAddress));
        logic = new GuardianLogic();
        wallet = new GuardianHost(address(logic));

        address[] memory guardians = new address[](1);
        guardians[0] = address(oidc);
        wallet.selfCall(
            abi.encodeCall(IGuardianLogic.setupGuardians, (guardians, 1, RECOVERY_DELAY, GUARDIAN_OP_DELAY))
        );

        vm.stopBroadcast();

        console2.log("KeyRegistry:          ", address(registry));
        console2.log("OidcRecoveryGuardian: ", address(oidc));
        console2.log("GuardianLogic:        ", address(logic));
        console2.log("GuardianHost (wallet):", address(wallet));
    }
}
