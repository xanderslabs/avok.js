// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {GuardianLogic} from "../src/GuardianLogic.sol";
import {AvokCalibur} from "../src/AvokCalibur.sol";

/// @notice Proves the CREATE2 determinism invariant that `DeployCanonical.s.sol` relies on, for
///         both deploys in the two-contract sequence.
///
/// INVARIANT: a CREATE2 address is
///   keccak256(0xff ++ deployer ++ salt ++ keccak256(creationCode))[12:]
/// — a pure function of (deployer, salt, creationCode). GuardianLogic has no constructor, so its
/// creation code is a compile-time constant. AvokCalibur's constructor takes GuardianLogic's own
/// address, which is itself a pure function of (deployer, GUARDIAN_LOGIC_SALT) — so once
/// GuardianLogic's address is fixed, AvokCalibur's creation code (constructor arg included) is
/// fixed too, and its CREATE2 address is chain-independent by the same formula.
///
/// TEST-EVM SUBTLETY: inside `forge test`, `new X{salt}()` uses THIS test contract as the CREATE2
/// deployer, whereas the forge *script* routes through 0x4e59.... This test therefore proves
/// determinism in two complementary, honest pieces, for EACH contract:
///   (a) an actual from-scratch CREATE2 deploy (from a known deployer) whose resulting address ==
///       vm.computeCreate2Address(salt, codehash, thatDeployer) and whose code == runtimeCode;
///   (b) a pinned GOLDEN literal for the 0x4e59-deployer prediction, locking the true cross-chain
///       address so any salt / bytecode / compiler drift fails loudly.
/// We deliberately do NOT vm.etch a hand-typed 0x4e59 proxy bytecode: trusting an unverified
/// runtime blob in a fund-critical determinism proof would be worse than proving the formula
/// directly.
contract DeployCanonicalTest is Test {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    // Must stay identical to DeployCanonical.s.sol's salts.
    bytes32 internal constant GUARDIAN_LOGIC_SALT = keccak256("avok.guardianlogic.canonical");
    bytes32 internal constant AVOK_CALIBUR_SALT = keccak256("avok.calibur.canonical");

    /// GOLDEN: canonical cross-chain GuardianLogic address = CREATE2(0x4e59..., salt, creationCode).
    /// First baseline, 2026-08-16. registry.ts canonicalGuardianLogic must match.
    address internal constant GOLDEN_GUARDIAN_LOGIC = 0x3425f573921EDe981BE97B1a63AA056e04Ae89A1;

    /// GOLDEN: canonical cross-chain AvokCalibur address, given GOLDEN_GUARDIAN_LOGIC as its
    /// constructor arg. First baseline, 2026-08-16. registry.ts canonicalAvokCalibur must match.
    address internal constant GOLDEN_AVOK_CALIBUR = 0x1a29eF50E033371d9686F027BD7d0743B1A0Cc3e;

    function test_guardianLogic_predictedAddressIsFixedNonZeroAndMatchesGolden() public pure {
        bytes32 codehash = keccak256(type(GuardianLogic).creationCode);
        address predicted = vm.computeCreate2Address(GUARDIAN_LOGIC_SALT, codehash, CREATE2_DEPLOYER);
        assertTrue(predicted != address(0), "predicted address must be non-zero");
        assertEq(predicted, GOLDEN_GUARDIAN_LOGIC, "GuardianLogic CREATE2 prediction drifted from golden");
    }

    function test_avokCalibur_predictedAddressIsFixedNonZeroAndMatchesGolden() public pure {
        bytes32 codehash =
            keccak256(abi.encodePacked(type(AvokCalibur).creationCode, abi.encode(GOLDEN_GUARDIAN_LOGIC)));
        address predicted = vm.computeCreate2Address(AVOK_CALIBUR_SALT, codehash, CREATE2_DEPLOYER);
        assertTrue(predicted != address(0), "predicted address must be non-zero");
        assertEq(predicted, GOLDEN_AVOK_CALIBUR, "AvokCalibur CREATE2 prediction drifted from golden");
    }

    function test_create2Deploy_matchesFormulaAndDeploysRuntimeCode() public {
        bytes32 guardianCodehash = keccak256(type(GuardianLogic).creationCode);
        GuardianLogic logic = new GuardianLogic{salt: GUARDIAN_LOGIC_SALT}();
        address expectedLogic = vm.computeCreate2Address(GUARDIAN_LOGIC_SALT, guardianCodehash, address(this));
        assertEq(address(logic), expectedLogic, "GuardianLogic CREATE2 address must match the formula");
        assertGt(address(logic).code.length, 0, "deployed GuardianLogic code must be non-empty");
        assertEq(
            address(logic).code, type(GuardianLogic).runtimeCode, "deployed code must equal GuardianLogic.runtimeCode"
        );

        bytes32 caliburCodehash =
            keccak256(abi.encodePacked(type(AvokCalibur).creationCode, abi.encode(address(logic))));
        AvokCalibur calibur = new AvokCalibur{salt: AVOK_CALIBUR_SALT}(address(logic));
        address expectedCalibur = vm.computeCreate2Address(AVOK_CALIBUR_SALT, caliburCodehash, address(this));
        assertEq(address(calibur), expectedCalibur, "AvokCalibur CREATE2 address must match the formula");
        assertGt(address(calibur).code.length, 0, "deployed AvokCalibur code must be non-empty");
        assertEq(calibur.GUARDIAN_LOGIC(), address(logic), "AvokCalibur must point at the deployed GuardianLogic");
    }
}
