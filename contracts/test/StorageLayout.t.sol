// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {GuardianLogic} from "../src/GuardianLogic.sol";
import {Calibur} from "calibur/Calibur.sol";

/// @notice Anti-drift and namespace-collision guard on GuardianLogic's ERC-7201 storage root.
///         If either assertion fails, either the derivation changed (revert it) or the namespace
///         genuinely collided with Calibur's own root (pick a new namespace — do not update the
///         expectation to make a real collision pass).
contract StorageLayoutTest is Test {
    GuardianLogic internal logic;
    Calibur internal calibur;

    function setUp() public {
        logic = new GuardianLogic();
        calibur = new Calibur();
    }

    function test_avokGuardiansSlot_matchesTheChiselDerivedValue() public view {
        bytes32 derived = keccak256(abi.encode(uint256(keccak256("avok.guardians")) - 1)) & ~bytes32(uint256(0xff));
        assertEq(logic.STORE_SLOT(), derived, "avok.guardians slot drifted from its derivation");
    }

    function test_avokGuardiansSlot_clearsCalibursNamespace() public view {
        assertTrue(
            logic.STORE_SLOT() != calibur.CUSTOM_STORAGE_ROOT(),
            "avok.guardians must not collide with Calibur's Uniswap.Calibur.1.0.0 root"
        );
    }
}
