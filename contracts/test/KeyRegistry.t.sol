// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {IKeyRegistry} from "../src/interfaces/IKeyRegistry.sol";

contract KeyRegistryTest is Test {
    KeyRegistry registry;
    address owner = makeAddr("owner");
    address a1 = makeAddr("a1");
    address a2 = makeAddr("a2");
    address a3 = makeAddr("a3");

    uint16 constant QUORUM = 2;
    uint40 constant ANCHOR_WINDOW = 1 hours;
    uint40 constant GRACE_WINDOW = 2 days;

    string constant ISSUER = "https://accounts.google.com";
    string constant KID = "abc123";
    // Masked to a canonical BN254 field element (top 3 bits dropped) — attest() now rejects a
    // raw, un-masked keccak256 output, per FieldElement.sol.
    bytes32 constant KEY_HASH = bytes32(uint256(keccak256("some-rsa-modulus-bytes")) & ((1 << 253) - 1));

    function setUp() public {
        address[] memory attestors = new address[](3);
        attestors[0] = a1;
        attestors[1] = a2;
        attestors[2] = a3;
        registry = new KeyRegistry(owner, attestors, QUORUM, ANCHOR_WINDOW, GRACE_WINDOW);
    }

    function test_notUsable_beforeAnyAttestation() public view {
        assertFalse(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_notUsable_belowQuorum() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW + 1);
        assertFalse(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_notUsable_beforeAnchorWindowElapsed() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH);
        // Quorum met immediately, but the anchor window hasn't elapsed since the FIRST attestation.
        assertFalse(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_usable_afterQuorumAndAnchorWindow() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW + 1);
        assertTrue(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_anchorClock_startsAtFirstAttestation_notQuorum() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW); // window elapses relative to a1's attestation
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH); // quorum reached late, clock already ran
        vm.warp(block.timestamp + 1);
        assertTrue(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_attest_revertsOnDoubleAttestFromSameAttestor() public {
        vm.startPrank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.expectRevert(IKeyRegistry.AlreadyAttested.selector);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.stopPrank();
    }

    function test_attest_revertsForNonAttestor() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IKeyRegistry.NotAttestor.selector);
        registry.attest(ISSUER, KID, KEY_HASH);
    }

    function test_contest_freezesUsability_oneAttestorEnough() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW + 1);
        assertTrue(registry.isKeyUsable(ISSUER, KID, KEY_HASH));

        vm.prank(a3);
        registry.contest(ISSUER, KID, KEY_HASH);
        assertFalse(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_contest_revertsOnUnknownRecord() public {
        vm.prank(a1);
        vm.expectRevert(IKeyRegistry.NoSuchRecord.selector);
        registry.contest(ISSUER, KID, KEY_HASH);
    }

    function test_uncontest_isOwnerOnly() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.contest(ISSUER, KID, KEY_HASH);

        vm.prank(a2);
        vm.expectRevert(bytes("not owner"));
        registry.uncontest(ISSUER, KID, KEY_HASH);

        vm.prank(owner);
        registry.uncontest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW + 1);
        assertTrue(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_rotation_usableInsideGraceWindow_deadAfter() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW + 1);
        assertTrue(registry.isKeyUsable(ISSUER, KID, KEY_HASH));

        vm.prank(a1);
        registry.attestRotated(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attestRotated(ISSUER, KID, KEY_HASH); // quorum -> validUntil = now

        // Still inside the grace window: an in-flight recovery using a token signed just before
        // rotation must not go dead mid-flight.
        vm.warp(block.timestamp + GRACE_WINDOW - 1);
        assertTrue(registry.isKeyUsable(ISSUER, KID, KEY_HASH));

        vm.warp(block.timestamp + 2);
        assertFalse(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_rotation_requiresQuorum_singleAttestorInsufficient() public {
        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW + 1);

        vm.prank(a1);
        registry.attestRotated(ISSUER, KID, KEY_HASH);
        // Only one of two required rotation attestations: still live, no grace-window decay yet.
        assertTrue(registry.isKeyUsable(ISSUER, KID, KEY_HASH));
    }

    function test_attestorManagement_addRemove() public {
        address a4 = makeAddr("a4");
        vm.prank(owner);
        registry.addAttestor(a4);
        assertTrue(registry.isAttestor(a4));

        vm.prank(owner);
        registry.removeAttestor(a1);
        assertFalse(registry.isAttestor(a1));

        vm.prank(a1);
        vm.expectRevert(IKeyRegistry.NotAttestor.selector);
        registry.attest(ISSUER, KID, KEY_HASH);
    }

    function test_constructor_revertsOnBadQuorum() public {
        address[] memory attestors = new address[](1);
        attestors[0] = a1;
        vm.expectRevert(bytes("bad quorum"));
        new KeyRegistry(owner, attestors, 2, ANCHOR_WINDOW, GRACE_WINDOW);
    }

    function test_attest_revertsOnNonCanonicalKeyHash() public {
        // Top bit set: guaranteed to exceed the 253-bit field mask.
        bytes32 nonCanonical = bytes32(uint256(1) << 255);
        vm.prank(a1);
        vm.expectRevert(IKeyRegistry.NotFieldElement.selector);
        registry.attest(ISSUER, KID, nonCanonical);
    }

    function test_removeAttestor_revertsBelowQuorum() public {
        // 3 attestors, quorum 2: removing one more after dropping to quorum would leave 1 < 2.
        vm.prank(owner);
        registry.removeAttestor(a1);
        assertEq(registry.attestors().length, 2);

        vm.prank(owner);
        vm.expectRevert(IKeyRegistry.BelowQuorum.selector);
        registry.removeAttestor(a2);
    }
}
