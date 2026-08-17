// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {AvokCalibur} from "../src/AvokCalibur.sol";
import {GuardianLogic} from "../src/GuardianLogic.sol";
import {IGuardianLogic} from "../src/interfaces/IGuardianLogic.sol";
import {Key, KeyType, KeyLib} from "calibur/libraries/KeyLib.sol";
import {SettingsLib} from "calibur/libraries/SettingsLib.sol";
import {Call} from "calibur/libraries/CallLib.sol";
import {BatchedCall} from "calibur/libraries/BatchedCallLib.sol";

/// @notice Delta-focused tests for AvokCalibur: the shims it adds over Calibur, and the
///         registerRecoveredKey promotion hook. Full end-to-end recovery lifecycle lives in
///         GuardianRecovery.t.sol's Task 7 additions (delegated-EOA scenarios).
contract GuardianRecoveryTest is Test {
    uint256 internal constant eoaPk = 0xA11CE;
    address internal wallet;
    GuardianLogic internal logic;
    address internal constant ATTACKER = address(0xBAD);
    address internal constant NEW_SIGNER = address(0x519E4);

    function setUp() public virtual {
        logic = new GuardianLogic();
        AvokCalibur impl = new AvokCalibur(address(logic));
        wallet = vm.addr(eoaPk);
        vm.etch(wallet, address(impl).code);
    }

    function w() internal view returns (AvokCalibur) {
        return AvokCalibur(payable(wallet));
    }

    function _isRegistered(address signer) internal view returns (bool) {
        return w().isRegistered(_hash(signer));
    }

    function _isAdmin(address signer) internal view returns (bool) {
        return SettingsLib.isAdmin(w().getKeySettings(_hash(signer)));
    }

    function _hash(address signer) internal pure returns (bytes32) {
        return KeyLib.hash(Key({keyType: KeyType.Secp256k1, publicKey: abi.encode(signer)}));
    }

    function test_unknownSelectorReverts() public {
        (bool ok,) = wallet.call(abi.encodeWithSignature("thisSelectorDoesNotExist()"));
        assertFalse(ok);
    }

    /// SOLE CALLER. Only the wallet itself may register a recovered key. Not an EOA holding the
    /// delegated key's signature, not an arbitrary attacker.
    function test_registerRecoveredKey_revertsWhenNotSelf() public {
        vm.expectRevert(IGuardianLogic.NotSelf.selector);
        w().registerRecoveredKey(NEW_SIGNER);

        vm.prank(ATTACKER);
        vm.expectRevert(IGuardianLogic.NotSelf.selector);
        w().registerRecoveredKey(NEW_SIGNER);
    }

    /// SOLE ACTION. Self-calling registerRecoveredKey registers exactly one key, and it is admin
    /// (full signer), matching the promotion semantics: one timelock, then instant full access.
    function test_registerRecoveredKey_registersAsAdmin() public {
        vm.prank(wallet);
        w().registerRecoveredKey(NEW_SIGNER);
        assertTrue(_isRegistered(NEW_SIGNER), "recovery must register the promoted key");
        assertTrue(_isAdmin(NEW_SIGNER), "a promoted key must be admin");
        assertFalse(_isRegistered(ATTACKER), "recovery must register nothing else");
    }

    /// NO ARBITRARY CALLDATA REACH. registerRecoveredKey takes exactly one typed address
    /// parameter, not an arbitrary bytes blob to decode, so there is no decode-time path to any
    /// other Calibur function or key type. (Unlike the retired applyRecovery(bytes), there is no
    /// malformed-payload surface here to test.)

    /// REPLAY SAFE. A duplicate self-call re-registers the same key: Calibur treats that as a safe
    /// no-op (matching the pre-guardian invariant), so a duplicate delivery changes nothing.
    function test_registerRecoveredKey_duplicateIsANoOp() public {
        vm.startPrank(wallet);
        w().registerRecoveredKey(NEW_SIGNER);
        w().registerRecoveredKey(NEW_SIGNER);
        vm.stopPrank();
        assertTrue(_isRegistered(NEW_SIGNER));
        assertEq(w().keyCount(), 1, "a duplicate must not add a second entry");
    }

    // --- Task 7: integration on a delegated EOA ---

    bytes32 internal constant MODE_BATCH = 0x0100000000000000000000000000000000000000000000000000000000000000;

    function _oneCall(address to, bytes memory data) internal pure returns (Call[] memory calls) {
        calls = new Call[](1);
        calls[0] = Call({to: to, value: 0, data: data});
    }

    /// @dev Self-call through the wallet's real execute() path: Calibur treats msg.sender ==
    ///      address(this) as the root key, so a self-targeted batch is the production route a
    ///      signed transaction from the EOA's own key would take.
    function _selfExecute(address wlt, bytes memory data) internal {
        vm.prank(wlt);
        AvokCalibur(payable(wlt)).execute(MODE_BATCH, abi.encode(_oneCall(wlt, data)));
    }

    function _setupGuardians(address wlt, address[] memory guardians, uint8 threshold) internal {
        _selfExecute(wlt, abi.encodeCall(IGuardianLogic.setupGuardians, (guardians, threshold, 24 hours, 12 hours)));
    }

    function _newWallet(uint256 pk) internal returns (address wlt) {
        wlt = vm.addr(pk);
        vm.etch(wlt, address(new AvokCalibur(address(logic))).code);
    }

    function test_lifecycle_recoveryPromotesAKeyThatCanThenExecute() public {
        (address g1, ) = makeAddrAndKey("g1life");
        (address g2, uint256 g2Pk) = makeAddrAndKey("g2life");
        address[] memory gs = new address[](2);
        gs[0] = g1; gs[1] = g2;
        _setupGuardians(wallet, gs, 2);

        address promoteKey = makeAddr("promoted");

        vm.prank(g1);
        IGuardianLogic(wallet).approveRecovery(promoteKey, 0);

        bytes32 digest = IGuardianLogic(wallet).recoveryApprovalDigest(promoteKey, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(g2Pk, digest);
        IGuardianLogic(wallet).approveRecoveryBySig(promoteKey, 0, g2, abi.encodePacked(r, s, v));

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(makeAddr("relayer"));
        IGuardianLogic(wallet).executeRecovery();

        assertTrue(_isRegistered(promoteKey), "promoted key must be registered");
        assertTrue(_isAdmin(promoteKey), "promoted key must be admin");

        // A transaction from the promoted key now executes through the account: Calibur resolves
        // msg.sender to its registered Secp256k1 keyHash (KeyLib.toKeyHash), so the promoted
        // address itself, with no separate signature step, can drive execute().
        Target target = new Target();
        Call[] memory calls = _oneCall(address(target), abi.encodeCall(Target.poke, ()));
        BatchedCall memory batch = BatchedCall({calls: calls, revertOnFailure: true});
        vm.prank(promoteKey);
        AvokCalibur(payable(wallet)).execute(batch);
        assertTrue(target.poked(), "the promoted key's batch must have executed");
    }

    function test_veto_recoveryDies() public {
        (address g1,) = makeAddrAndKey("g1veto");
        (address g2,) = makeAddrAndKey("g2veto");
        address[] memory gs = new address[](2);
        gs[0] = g1; gs[1] = g2;
        _setupGuardians(wallet, gs, 2);

        address promoteKey = makeAddr("promoted2");
        vm.prank(g1);
        IGuardianLogic(wallet).approveRecovery(promoteKey, 0);
        vm.prank(g2);
        IGuardianLogic(wallet).approveRecovery(promoteKey, 0);

        _selfExecute(wallet, abi.encodeCall(IGuardianLogic.vetoRecovery, ()));

        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert(IGuardianLogic.NoRecovery.selector);
        IGuardianLogic(wallet).executeRecovery();
    }

    /// @dev THE ATTACKER STORY. Two of two guardian keys are compromised and used to open a
    ///      recovery toward an attacker-controlled key. Nothing moves before readyAt (the 24h
    ///      timelock holds even under full guardian compromise), and the true owner's veto,
    ///      reachable only via the wallet's own signed execute path, kills it outright.
    function test_attackerStory_leakedGuardiansCannotBypassTheTimelock() public {
        (address g1,) = makeAddrAndKey("g1atk");
        (address g2,) = makeAddrAndKey("g2atk");
        address[] memory gs = new address[](2);
        gs[0] = g1; gs[1] = g2;
        _setupGuardians(wallet, gs, 2);

        address attackerKey = makeAddr("attackerKey");
        vm.prank(g1);
        IGuardianLogic(wallet).approveRecovery(attackerKey, 0);
        vm.prank(g2);
        IGuardianLogic(wallet).approveRecovery(attackerKey, 0);

        (,,, uint40 readyAt) = IGuardianLogic(wallet).getPendingRecovery();
        assertTrue(readyAt > block.timestamp);

        vm.expectRevert(IGuardianLogic.RecoveryNotReady.selector);
        IGuardianLogic(wallet).executeRecovery();

        _selfExecute(wallet, abi.encodeCall(IGuardianLogic.vetoRecovery, ()));

        vm.warp(readyAt + 1);
        vm.expectRevert(IGuardianLogic.NoRecovery.selector);
        IGuardianLogic(wallet).executeRecovery();
        assertFalse(_isRegistered(attackerKey), "the attacker's key must never be registered");
    }

    function test_storageIsolation_twoWalletsDoNotBleed() public {
        address walletB = _newWallet(0xB0B);

        (address g1a,) = makeAddrAndKey("g1a");
        (address g2a,) = makeAddrAndKey("g2a");
        address[] memory gsA = new address[](2);
        gsA[0] = g1a; gsA[1] = g2a;
        _setupGuardians(wallet, gsA, 2);

        (address g1b,) = makeAddrAndKey("g1b");
        (address g2b,) = makeAddrAndKey("g2b");
        (address g3b,) = makeAddrAndKey("g3b");
        address[] memory gsB = new address[](3);
        gsB[0] = g1b; gsB[1] = g2b; gsB[2] = g3b;
        _setupGuardians(walletB, gsB, 3);

        (address[] memory storedA, uint8 tA,,) = IGuardianLogic(wallet).getGuardianConfig();
        (address[] memory storedB, uint8 tB,,) = IGuardianLogic(walletB).getGuardianConfig();
        assertEq(storedA.length, 2);
        assertEq(storedB.length, 3);
        assertEq(tA, 2);
        assertEq(tB, 3);

        address promoteA = makeAddr("promoteA");
        vm.prank(g1a);
        IGuardianLogic(wallet).approveRecovery(promoteA, 0);

        (address pkA,, uint8 apprA,) = IGuardianLogic(wallet).getPendingRecovery();
        (address pkB,, uint8 apprB,) = IGuardianLogic(walletB).getPendingRecovery();
        assertEq(pkA, promoteA);
        assertEq(apprA, 1);
        assertEq(pkB, address(0));
        assertEq(apprB, 0);
    }
}

contract Target {
    bool public poked;
    function poke() external { poked = true; }
}
