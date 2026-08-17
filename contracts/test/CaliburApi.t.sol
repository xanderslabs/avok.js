// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { Calibur } from "calibur/Calibur.sol";
import { Key, KeyType } from "calibur/libraries/KeyLib.sol";
import { Settings, SettingsLib } from "calibur/libraries/SettingsLib.sol";

/// @notice Pins the inherited surface this repo's own contracts are written against.
/// @dev NOT a test of Calibur. A test of the ASSUMPTIONS Avok makes about Calibur, so a dependency
///      bump that moves them fails here rather than somewhere subtle at runtime. Every assertion
///      here corresponds to a sentence in key-model section 4; if one fails, that section is what
///      needs correcting, not this file.
///
///      Pinned at calibur v1.1.0 (249cac5e880831d7b2de4111a5920dbf0d242846).
contract CaliburApiTest is Test {
    Calibur internal calibur;

    function setUp() public {
        calibur = new Calibur();
    }

    /// Avok uses Secp256k1 for both the root key and every device signer, because it is the one curve
    /// every EVM chain verifies natively via ecrecover. P256 and WebAuthnP256 need RIP-7212, which is
    /// not universal, so they go unused in v1.
    function test_KeyTypeEnumIsTheThreeWeExpect() public pure {
        assertEq(uint8(KeyType.P256), 0, "P256 must stay at 0");
        assertEq(uint8(KeyType.WebAuthnP256), 1, "WebAuthnP256 must stay at 1");
        assertEq(uint8(KeyType.Secp256k1), 2, "Secp256k1 must stay at 2");
    }

    /// The Key struct is what `register` takes and what recovery will construct, so its shape is part
    /// of Avok's own surface. A compile failure here IS the assertion.
    function test_KeyStructShape() public pure {
        Key memory key = Key({ keyType: KeyType.Secp256k1, publicKey: abi.encode(address(0xBEEF)) });
        assertEq(uint8(key.keyType), uint8(KeyType.Secp256k1));
        assertEq(key.publicKey, abi.encode(address(0xBEEF)));
    }

    /// register and revoke are onlyThis: reachable only through a self-call, which in practice means
    /// an execute signed by an admin key. This is WHY applyRecovery self-calls register rather than
    /// having the manager call it directly, and why no external contract can gain authority here.
    function test_RegisterIsOnlyThis() public {
        Key memory key = Key({ keyType: KeyType.Secp256k1, publicKey: abi.encode(address(0xBEEF)) });
        vm.expectRevert();
        calibur.register(key);
    }

    function test_RevokeIsOnlyThis() public {
        vm.expectRevert();
        calibur.revoke(bytes32(uint256(1)));
    }

    /// The admin flag lives at bit 200 of the per-key Settings word. Recovery registers a NON-admin
    /// key, so this bit is the difference between restoring access and handing over the account.
    function test_AdminFlagIsBit200() public pure {
        Settings admin = Settings.wrap(uint256(1) << 200);
        Settings notAdmin = Settings.wrap(0);
        assertTrue(SettingsLib.isAdmin(admin), "bit 200 must mean admin");
        assertFalse(SettingsLib.isAdmin(notAdmin), "an empty settings word must not be admin");
    }

    /// A self-call is the ONLY route in. Proven rather than assumed: the same call that reverts from
    /// a stranger succeeds when the account calls itself.
    function test_RegisterSucceedsViaSelfCall() public {
        Key memory key = Key({ keyType: KeyType.Secp256k1, publicKey: abi.encode(address(0xBEEF)) });
        vm.prank(address(calibur));
        calibur.register(key);
        assertEq(calibur.keyCount(), 1, "a self-called register must take effect");
    }
}
