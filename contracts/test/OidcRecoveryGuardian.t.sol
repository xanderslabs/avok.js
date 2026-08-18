// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {GuardianLogic} from "../src/GuardianLogic.sol";
import {IGuardianLogic} from "../src/interfaces/IGuardianLogic.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {OidcRecoveryGuardian} from "../src/OidcRecoveryGuardian.sol";
import {IOidcRecoveryGuardian} from "../src/interfaces/IOidcRecoveryGuardian.sol";
import {GuardianHost} from "./mocks/GuardianHost.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

/// @notice Integration test: OidcRecoveryGuardian submitting an approval into a real
///         GuardianLogic-backed wallet (via GuardianHost, the same delegatecall stand-in
///         GuardianLogic.t.sol uses), so the whole chain — key usability, identity match, nonce
///         binding, proof verify, then the actual GuardianLogic.approveRecovery threshold/
///         timelock path — is exercised together, not just each contract in isolation.
contract OidcRecoveryGuardianTest is Test {
    GuardianLogic logic;
    GuardianHost wallet;
    KeyRegistry registry;
    MockVerifier verifier;
    OidcRecoveryGuardian oidc;

    address owner = makeAddr("owner");
    address a1 = makeAddr("a1");
    address a2 = makeAddr("a2");
    address addressGuardian = makeAddr("addressGuardian");
    address promoteKey = makeAddr("promoteKey");

    uint16 constant QUORUM = 2;
    uint40 constant ANCHOR_WINDOW = 1 hours;
    uint40 constant GRACE_WINDOW = 2 days;

    string constant ISSUER = "https://accounts.google.com";
    string constant KID = "abc123";
    // Both masked to canonical BN254 field elements (top 3 bits dropped) — attest() and
    // setRecoveryIdentity() now reject raw, un-masked keccak256 outputs, per FieldElement.sol.
    bytes32 constant KEY_HASH = bytes32(uint256(keccak256("some-rsa-modulus-bytes")) & ((1 << 253) - 1));
    bytes32 constant IDENTITY = bytes32(uint256(keccak256("emailHash|sub|iss")) & ((1 << 253) - 1));

    function setUp() public {
        logic = new GuardianLogic();
        wallet = new GuardianHost(address(logic));

        address[] memory attestors = new address[](2);
        attestors[0] = a1;
        attestors[1] = a2;
        registry = new KeyRegistry(owner, attestors, QUORUM, ANCHOR_WINDOW, GRACE_WINDOW);

        verifier = new MockVerifier();
        oidc = new OidcRecoveryGuardian(registry, verifier);

        // Two-of-two: one ordinary address guardian, one identity guardian — matches the D7
        // decision that identity is bounded by the SAME threshold+timelock as any other method,
        // and demonstrates OidcRecoveryGuardian is "one more approver, no special power."
        address[] memory guardians = new address[](2);
        guardians[0] = addressGuardian;
        guardians[1] = address(oidc);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (guardians, 2, 24 hours, 12 hours)));

        vm.prank(a1);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.prank(a2);
        registry.attest(ISSUER, KID, KEY_HASH);
        vm.warp(block.timestamp + ANCHOR_WINDOW + 1);

        vm.prank(address(wallet));
        oidc.setRecoveryIdentity(IDENTITY);
    }

    function _validPublicInputs(uint64 nonce) internal view returns (bytes32[] memory) {
        bytes32[] memory inputs = new bytes32[](3);
        inputs[0] = KEY_HASH;
        inputs[1] = IDENTITY;
        inputs[2] =
            bytes32(uint256(keccak256(abi.encode(address(wallet), promoteKey, nonce, block.chainid))) & ((1 << 253) - 1));
        return inputs;
    }

    function test_submitRecoveryApproval_countsAsOneGuardianApproval() public {
        bytes32[] memory inputs = _validPublicInputs(0);
        oidc.submitRecoveryApproval(address(wallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);

        (address pk, , uint8 approvals, uint40 readyAt) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(pk, promoteKey);
        assertEq(approvals, 1);
        assertEq(readyAt, 0); // threshold is 2; not started yet
    }

    function test_thresholdReached_combinedWithAddressGuardian_startsTimelock() public {
        bytes32[] memory inputs = _validPublicInputs(0);
        oidc.submitRecoveryApproval(address(wallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);

        vm.prank(addressGuardian);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);

        (, , uint8 approvals, uint40 readyAt) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(approvals, 2);
        assertEq(readyAt, block.timestamp + 24 hours);
    }

    function test_reverts_whenNoIdentityConfigured() public {
        GuardianHost otherWallet = new GuardianHost(address(logic));
        address[] memory guardians = new address[](1);
        guardians[0] = address(oidc);
        otherWallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (guardians, 1, 24 hours, 12 hours)));

        bytes32[] memory inputs = _validPublicInputs(0);
        vm.expectRevert(IOidcRecoveryGuardian.NoIdentityConfigured.selector);
        oidc.submitRecoveryApproval(address(otherWallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);
    }

    function test_reverts_whenKeyNotUsable_contested() public {
        vm.prank(a1);
        registry.contest(ISSUER, KID, KEY_HASH);
        bytes32[] memory inputs = _validPublicInputs(0);
        vm.expectRevert(IOidcRecoveryGuardian.KeyNotUsable.selector);
        oidc.submitRecoveryApproval(address(wallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);
    }

    function test_reverts_whenIdentityMismatch() public {
        bytes32[] memory inputs = _validPublicInputs(0);
        inputs[1] = keccak256("wrong-identity");
        vm.expectRevert(IOidcRecoveryGuardian.IdentityMismatch.selector);
        oidc.submitRecoveryApproval(address(wallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);
    }

    function test_reverts_whenNonceBindingMismatch_wrongPromoteKey() public {
        // Public inputs bound to a DIFFERENT promoteKey than the one being submitted — this is
        // exactly the replay this check exists to stop: a captured proof reused to promote an
        // attacker's key instead of the one the user actually proved for.
        bytes32[] memory inputs = new bytes32[](3);
        inputs[0] = KEY_HASH;
        inputs[1] = IDENTITY;
        inputs[2] = keccak256(abi.encode(address(wallet), makeAddr("attackerKey"), uint64(0), block.chainid));
        vm.expectRevert(IOidcRecoveryGuardian.NonceBindingMismatch.selector);
        oidc.submitRecoveryApproval(address(wallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);
    }

    function test_reverts_whenProofInvalid() public {
        verifier.setNextResult(false);
        bytes32[] memory inputs = _validPublicInputs(0);
        vm.expectRevert(IOidcRecoveryGuardian.InvalidProof.selector);
        oidc.submitRecoveryApproval(address(wallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);
    }

    function test_reverts_whenPublicKeyHashMismatch() public {
        bytes32[] memory inputs = _validPublicInputs(0);
        inputs[0] = keccak256("different-key");
        vm.expectRevert(IOidcRecoveryGuardian.KeyNotUsable.selector);
        oidc.submitRecoveryApproval(address(wallet), promoteKey, 0, ISSUER, KID, KEY_HASH, "proof-bytes", inputs);
    }

    // --- Recovery identity setup / change timelock ---

    function test_firstSetRecoveryIdentity_isImmediate() public {
        GuardianHost otherWallet = new GuardianHost(address(logic));
        vm.prank(address(otherWallet));
        oidc.setRecoveryIdentity(IDENTITY);
        (bytes32 commitment, , ) = oidc.getRecoveryIdentity(address(otherWallet));
        assertEq(commitment, IDENTITY);
    }

    function test_changeRecoveryIdentity_isTimelockedAndVetoable() public {
        bytes32 newIdentity = bytes32(uint256(keccak256("new-identity")) & ((1 << 253) - 1));
        vm.prank(address(wallet));
        oidc.setRecoveryIdentity(newIdentity);

        (bytes32 commitment, bytes32 pending, uint40 readyAt) = oidc.getRecoveryIdentity(address(wallet));
        assertEq(commitment, IDENTITY); // unchanged yet
        assertEq(pending, newIdentity);
        assertEq(readyAt, block.timestamp + 12 hours);

        vm.expectRevert(IOidcRecoveryGuardian.ChangeNotReady.selector);
        oidc.applyRecoveryIdentityChange(address(wallet));

        vm.prank(address(wallet));
        oidc.vetoRecoveryIdentityChange();
        (commitment, pending, readyAt) = oidc.getRecoveryIdentity(address(wallet));
        assertEq(pending, bytes32(0));
        assertEq(readyAt, 0);

        vm.prank(address(wallet));
        oidc.setRecoveryIdentity(newIdentity);
        vm.warp(block.timestamp + 12 hours);
        oidc.applyRecoveryIdentityChange(address(wallet));
        (commitment, , ) = oidc.getRecoveryIdentity(address(wallet));
        assertEq(commitment, newIdentity);
    }

    function test_setRecoveryIdentity_revertsOnNonCanonicalCommitment() public {
        GuardianHost otherWallet = new GuardianHost(address(logic));
        // Top bit set: guaranteed to exceed the 253-bit field mask.
        bytes32 nonCanonical = bytes32(uint256(1) << 255);
        vm.prank(address(otherWallet));
        vm.expectRevert(IOidcRecoveryGuardian.NotFieldElement.selector);
        oidc.setRecoveryIdentity(nonCanonical);
    }
}
