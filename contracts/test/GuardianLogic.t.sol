// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {GuardianLogic} from "../src/GuardianLogic.sol";
import {IGuardianLogic} from "../src/interfaces/IGuardianLogic.sol";
import {GuardianHost} from "./mocks/GuardianHost.sol";

contract GuardianLogicTest is Test {
    GuardianLogic logic;
    GuardianHost wallet;
    address g1 = makeAddr("g1");
    address g2 = makeAddr("g2");
    address g3 = makeAddr("g3");

    function setUp() public {
        logic = new GuardianLogic();
        wallet = new GuardianHost(address(logic));
    }

    function _setup(uint8 threshold) internal {
        address[] memory gs = new address[](3);
        gs[0] = g1; gs[1] = g2; gs[2] = g3;
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, threshold, 24 hours, 12 hours)));
    }

    function test_setup_storesConfig() public {
        _setup(2);
        (address[] memory gs, uint8 t, uint40 rd, uint40 gd) =
            IGuardianLogic(address(wallet)).getGuardianConfig();
        assertEq(gs.length, 3);
        assertEq(t, 2);
        assertEq(rd, 24 hours);
        assertEq(gd, 12 hours);
    }

    function test_setup_revertsWhenNotSelf() public {
        address[] memory gs = new address[](1);
        gs[0] = g1;
        vm.expectRevert(IGuardianLogic.NotSelf.selector);
        IGuardianLogic(address(wallet)).setupGuardians(gs, 1, 24 hours, 12 hours);
    }

    function test_setup_revertsOnSecondSetup() public {
        _setup(2);
        address[] memory gs = new address[](1);
        gs[0] = g1;
        vm.expectRevert(IGuardianLogic.AlreadySetup.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 1, 24 hours, 12 hours)));
    }

    function test_setup_boundsAndThreshold() public {
        address[] memory gs = new address[](2);
        gs[0] = g1; gs[1] = g2;
        vm.expectRevert(IGuardianLogic.DelayOutOfBounds.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 1, 30 minutes, 12 hours)));
        vm.expectRevert(IGuardianLogic.DelayOutOfBounds.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 1, 24 hours, 31 days)));
        vm.expectRevert(IGuardianLogic.BadThreshold.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 3, 24 hours, 12 hours)));
        vm.expectRevert(IGuardianLogic.BadThreshold.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 0, 24 hours, 12 hours)));
    }

    function test_setup_rejectsDuplicateGuardian() public {
        address[] memory gs = new address[](2);
        gs[0] = g1; gs[1] = g1;
        vm.expectRevert(IGuardianLogic.DuplicateGuardian.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 1, 24 hours, 12 hours)));
    }

    // --- Task 2: guardian-set changes under the 12h timelock ---

    address g4 = makeAddr("g4");

    function _opHash(IGuardianLogic.GuardianOp memory op) internal pure returns (bytes32) {
        return keccak256(abi.encode(op));
    }

    function _propose(IGuardianLogic.GuardianOp memory op) internal {
        wallet.selfCall(abi.encodeCall(IGuardianLogic.proposeGuardianOp, (op)));
    }

    function test_guardianOp_addAppliesAfterDelay() public {
        _setup(2);
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Add, guardian: g4, newThreshold: 0, nonce: 0});
        _propose(op);
        vm.warp(block.timestamp + 12 hours);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.executeGuardianOp, (op)));
        (address[] memory gs,,,) = IGuardianLogic(address(wallet)).getGuardianConfig();
        assertEq(gs.length, 4);
        assertEq(gs[3], g4);
    }

    function test_guardianOp_executeBeforeReadyReverts() public {
        _setup(2);
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Add, guardian: g4, newThreshold: 0, nonce: 0});
        _propose(op);
        vm.expectRevert(IGuardianLogic.OpNotReady.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.executeGuardianOp, (op)));
    }

    function test_guardianOp_vetoThenExecuteReverts() public {
        _setup(2);
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Add, guardian: g4, newThreshold: 0, nonce: 0});
        _propose(op);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.vetoGuardianOp, (_opHash(op))));
        vm.warp(block.timestamp + 12 hours);
        vm.expectRevert(IGuardianLogic.OpNotPending.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.executeGuardianOp, (op)));
    }

    function test_guardianOp_removeBelowThresholdReverts() public {
        _setup(3);
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Remove, guardian: g1, newThreshold: 0, nonce: 0});
        _propose(op);
        vm.warp(block.timestamp + 12 hours);
        vm.expectRevert(IGuardianLogic.BadThreshold.selector);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.executeGuardianOp, (op)));
    }

    function test_guardianOp_proposeRevertsWhenNotSelf() public {
        _setup(2);
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Add, guardian: g4, newThreshold: 0, nonce: 0});
        vm.expectRevert(IGuardianLogic.NotSelf.selector);
        IGuardianLogic(address(wallet)).proposeGuardianOp(op);
    }

    function test_guardianOp_nonceReuseReverts() public {
        _setup(2);
        IGuardianLogic.GuardianOp memory op1 =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Add, guardian: g4, newThreshold: 0, nonce: 0});
        _propose(op1);
        IGuardianLogic.GuardianOp memory op2 = IGuardianLogic.GuardianOp({
            kind: IGuardianLogic.OpKind.SetThreshold,
            guardian: address(0),
            newThreshold: 2,
            nonce: 0
        });
        vm.expectRevert(IGuardianLogic.NonceUsed.selector);
        _propose(op2);
    }

    function test_guardianOp_proposeRevertsBeforeSetup() public {
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Add, guardian: g4, newThreshold: 0, nonce: 0});
        vm.expectRevert(IGuardianLogic.NotSetup.selector);
        _propose(op);
    }

    // --- Task 3: recovery approvals, threshold, and the 24h clock ---

    address promoteKey = makeAddr("promoteKey");

    function test_recovery_firstApprovalOpensPending() public {
        _setup(2);
        vm.prank(g1);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        (address pk, uint64 n, uint8 approvals, uint40 readyAt) =
            IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(pk, promoteKey);
        assertEq(n, 0);
        assertEq(approvals, 1);
        assertEq(readyAt, 0);
    }

    function test_recovery_reachingThresholdStartsClock() public {
        _setup(2);
        vm.prank(g1);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        vm.prank(g2);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        (,, uint8 approvals, uint40 readyAt) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(approvals, 2);
        assertEq(readyAt, uint40(block.timestamp) + 24 hours);
    }

    function test_recovery_unaffectedByAnUnrelatedGuardianOp() public {
        _setup(2);
        vm.prank(g1);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);

        // An ordinary, unrelated guardian-roster change happens while the recovery is pending.
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Add, guardian: g4, newThreshold: 0, nonce: 0});
        _propose(op);
        vm.warp(block.timestamp + 12 hours);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.executeGuardianOp, (op)));

        // g2's approval, still against recovery nonce 0, must still land and reach threshold.
        vm.prank(g2);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        (,, uint8 approvals, uint40 readyAt) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(approvals, 2);
        assertEq(readyAt, uint40(block.timestamp) + 24 hours);
    }

    function test_recovery_removedGuardiansApprovalNoLongerCounts() public {
        _setup(2);
        vm.prank(g1);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        (,, uint8 approvalsBefore,) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(approvalsBefore, 1);

        // Admin removes g1 (its guardian-op nonce is independent of the recovery nonce above).
        IGuardianLogic.GuardianOp memory op =
            IGuardianLogic.GuardianOp({kind: IGuardianLogic.OpKind.Remove, guardian: g1, newThreshold: 0, nonce: 0});
        _propose(op);
        vm.warp(block.timestamp + 12 hours);
        wallet.selfCall(abi.encodeCall(IGuardianLogic.executeGuardianOp, (op)));

        (,, uint8 approvalsAfter,) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(approvalsAfter, 0, "a removed guardian's approval must no longer count");

        // g2 alone must not be enough to reach the original threshold of 2.
        vm.prank(g2);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        (,, uint8 approvalsFinal, uint40 readyAt) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(approvalsFinal, 1);
        assertEq(readyAt, 0, "recovery must not start on a single remaining approval");
    }

    function test_recovery_nonGuardianReverts() public {
        _setup(2);
        vm.expectRevert(IGuardianLogic.NotGuardian.selector);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
    }

    function test_recovery_doubleApproveReverts() public {
        _setup(2);
        vm.prank(g1);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        vm.prank(g1);
        vm.expectRevert(IGuardianLogic.AlreadyApproved.selector);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
    }

    function test_recovery_mismatchedPromoteKeyReverts() public {
        _setup(2);
        vm.prank(g1);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        vm.prank(g2);
        vm.expectRevert(IGuardianLogic.RecoveryMismatch.selector);
        IGuardianLogic(address(wallet)).approveRecovery(makeAddr("other"), 0);
    }

    function test_recovery_wrongNonceReverts() public {
        _setup(2);
        vm.prank(g1);
        vm.expectRevert(IGuardianLogic.NonceUsed.selector);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 1);
    }

    function test_recovery_zeroKeyReverts() public {
        _setup(2);
        vm.prank(g1);
        vm.expectRevert(IGuardianLogic.ZeroKey.selector);
        IGuardianLogic(address(wallet)).approveRecovery(address(0), 0);
    }

    // --- Task 4: EIP-712 signature approvals ---

    function test_sig_relayedApprovalCountsAsGuardians() public {
        (address g1Addr, uint256 g1Pk) = makeAddrAndKey("g1sig");
        address[] memory gs = new address[](2);
        gs[0] = g1Addr; gs[1] = g2;
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 2, 24 hours, 12 hours)));

        bytes32 digest = IGuardianLogic(address(wallet)).recoveryApprovalDigest(promoteKey, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(g1Pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        address relayer = makeAddr("relayer");
        vm.prank(relayer);
        IGuardianLogic(address(wallet)).approveRecoveryBySig(promoteKey, 0, g1Addr, sig);

        (,, uint8 approvals,) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(approvals, 1);
    }

    function test_sig_tamperedDigestReverts() public {
        (address g1Addr, uint256 g1Pk) = makeAddrAndKey("g1sig");
        address[] memory gs = new address[](2);
        gs[0] = g1Addr; gs[1] = g2;
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 2, 24 hours, 12 hours)));

        bytes32 wrongDigest = IGuardianLogic(address(wallet)).recoveryApprovalDigest(makeAddr("wrong"), 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(g1Pk, wrongDigest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(IGuardianLogic.BadSignature.selector);
        IGuardianLogic(address(wallet)).approveRecoveryBySig(promoteKey, 0, g1Addr, sig);
    }

    function test_sig_nonGuardianKeyReverts() public {
        _setup(2);
        (, uint256 otherPk) = makeAddrAndKey("notAGuardian");
        bytes32 digest = IGuardianLogic(address(wallet)).recoveryApprovalDigest(promoteKey, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(IGuardianLogic.NotGuardian.selector);
        IGuardianLogic(address(wallet)).approveRecoveryBySig(promoteKey, 0, vm.addr(otherPk), sig);
    }

    function test_sig_replayReverts() public {
        (address g1Addr, uint256 g1Pk) = makeAddrAndKey("g1sig");
        address[] memory gs = new address[](2);
        gs[0] = g1Addr; gs[1] = g2;
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 2, 24 hours, 12 hours)));

        bytes32 digest = IGuardianLogic(address(wallet)).recoveryApprovalDigest(promoteKey, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(g1Pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        IGuardianLogic(address(wallet)).approveRecoveryBySig(promoteKey, 0, g1Addr, sig);
        vm.expectRevert(IGuardianLogic.AlreadyApproved.selector);
        IGuardianLogic(address(wallet)).approveRecoveryBySig(promoteKey, 0, g1Addr, sig);
    }

    function test_sig_digestChangesWithChainId() public {
        bytes32 digestA = IGuardianLogic(address(wallet)).recoveryApprovalDigest(promoteKey, 0);
        vm.chainId(999);
        bytes32 digestB = IGuardianLogic(address(wallet)).recoveryApprovalDigest(promoteKey, 0);
        assertTrue(digestA != digestB);
    }

    function test_sig_digestDiffersAcrossWallets() public {
        GuardianHost wallet2 = new GuardianHost(address(logic));
        bytes32 digestA = IGuardianLogic(address(wallet)).recoveryApprovalDigest(promoteKey, 0);
        bytes32 digestB = IGuardianLogic(address(wallet2)).recoveryApprovalDigest(promoteKey, 0);
        assertTrue(digestA != digestB);
    }

    // --- Task 5: veto and execute (promotion) ---

    function _approveToThreshold() internal {
        _setup(2);
        vm.prank(g1);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        vm.prank(g2);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
    }

    function test_execute_happyPathPromotes() public {
        _approveToThreshold();
        vm.warp(block.timestamp + 24 hours + 1);
        address relayer = makeAddr("relayer");
        vm.prank(relayer);
        IGuardianLogic(address(wallet)).executeRecovery();

        assertEq(wallet.promoted(0), promoteKey);
        (address pk,, uint8 approvals, uint40 readyAt) = IGuardianLogic(address(wallet)).getPendingRecovery();
        assertEq(pk, address(0));
        assertEq(approvals, 0);
        assertEq(readyAt, 0);
    }

    function test_execute_bumpsNonceKillingStaleSig() public {
        (address g1Addr, uint256 g1Pk) = makeAddrAndKey("g1exec");
        address[] memory gs = new address[](2);
        gs[0] = g1Addr; gs[1] = g2;
        wallet.selfCall(abi.encodeCall(IGuardianLogic.setupGuardians, (gs, 2, 24 hours, 12 hours)));

        bytes32 digest = IGuardianLogic(address(wallet)).recoveryApprovalDigest(promoteKey, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(g1Pk, digest);
        bytes memory staleSig = abi.encodePacked(r, s, v);

        vm.prank(g1Addr);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        vm.prank(g2);
        IGuardianLogic(address(wallet)).approveRecovery(promoteKey, 0);
        vm.warp(block.timestamp + 24 hours + 1);
        IGuardianLogic(address(wallet)).executeRecovery();

        vm.expectRevert(IGuardianLogic.NonceUsed.selector);
        IGuardianLogic(address(wallet)).approveRecoveryBySig(promoteKey, 0, g1Addr, staleSig);
    }

    function test_execute_beforeReadyReverts() public {
        _approveToThreshold();
        vm.expectRevert(IGuardianLogic.RecoveryNotReady.selector);
        IGuardianLogic(address(wallet)).executeRecovery();
    }

    function test_execute_afterVetoRevertsNoRecovery() public {
        _approveToThreshold();
        wallet.selfCall(abi.encodeCall(IGuardianLogic.vetoRecovery, ()));
        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert(IGuardianLogic.NoRecovery.selector);
        IGuardianLogic(address(wallet)).executeRecovery();
    }

    function test_veto_revertsWhenNotSelf() public {
        _approveToThreshold();
        vm.expectRevert(IGuardianLogic.NotSelf.selector);
        IGuardianLogic(address(wallet)).vetoRecovery();
    }

    function test_execute_withNoRecoveryReverts() public {
        _setup(2);
        vm.expectRevert(IGuardianLogic.NoRecovery.selector);
        IGuardianLogic(address(wallet)).executeRecovery();
    }
}
