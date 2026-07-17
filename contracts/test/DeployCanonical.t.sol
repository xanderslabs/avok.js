// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

/// @notice Proves the CREATE2 determinism invariant that `DeployCanonical.s.sol` relies on.
///
/// INVARIANT: a CREATE2 address is
///   keccak256(0xff ++ deployer ++ salt ++ keccak256(creationCode))[12:]
/// — a pure function of (deployer, salt, creationCode). Here `salt` (SALT) and
/// `creationCode` (no constructor, no immutables) are compile-time constants, and the
/// EVM CREATE2 opcode is chain-independent. So pinning deployer = 0x4e59... (the deployer
/// the script routes through, present on every EVM chain) yields ONE address on all chains.
///
/// TEST-EVM SUBTLETY: inside `forge test`, `new X{salt}()` uses THIS test contract as the
/// CREATE2 deployer, whereas the forge *script* routes through 0x4e59.... This test therefore
/// proves determinism in two complementary, honest pieces:
///   (a) an actual from-scratch CREATE2 deploy (from a known deployer) whose resulting
///       address == vm.computeCreate2Address(SALT, codehash, thatDeployer) and whose code
///       == runtimeCode — proving the address formula holds for our exact salt + bytecode
///       AND that the deployed code is correct;
///   (b) a pinned GOLDEN literal for the 0x4e59-deployer prediction (Foundry's own correct
///       implementation of the CREATE2 formula) — locking the true cross-chain address so any
///       salt / bytecode / compiler drift fails loudly.
/// We deliberately do NOT vm.etch a hand-typed 0x4e59 proxy bytecode: trusting an unverified
/// runtime blob in a fund-critical determinism proof would be worse than proving the formula
/// directly. (a)+(b) together establish the same guarantee the script carries.
contract DeployCanonicalTest is Test {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    // Must stay identical to DeployCanonical.s.sol's SALT.
    bytes32 internal constant SALT = keccak256("avok.wallet.canonical");

    /// GOLDEN: the canonical cross-chain address = CREATE2(0x4e59..., SALT, creationCode).
    /// If this assertion ever fails, the salt or the contract bytecode changed and wallets
    /// would delegate to a DIFFERENT address on future deploys. Treat any change as a
    /// breaking, deliberate re-version — never a silent edit.
    /// registry.ts canonicalImplementation must match.
    ///
    /// RE-BASELINED 2026-07-17. Prior: 0x59f9…54A8 (itself a re-baseline from 0xFED0…F705,
    /// Arc-testnet-verified 2026-07-14). NEEDS A RE-DEPLOY. Five deliberate changes moved it, batched
    /// into ONE address move rather than five:
    ///
    ///   1. bytecode_hash = "none" (foundry.toml). THE IMPORTANT ONE, and it ends a recurring tax.
    ///      Both prior re-baselines were caused by solc's CBOR metadata — an IPFS hash OF THE SOURCE,
    ///      comments included — so editing a docstring moved this address. Measured: a comment-only
    ///      edit took the bytecode 407cb032… → e0542316… while the executable code stayed identical
    ///      for 13,504 of 13,590 chars. With the trailer stripped, comments no longer move it. This
    ///      is the last address move documentation can ever cause.
    ///   2. IPasskeyAccessVault advertised via ERC-165 — conformance is now detectable on chain.
    ///   3. Unauthorized() moved into the standard's interface (same selector; the local copy went).
    ///   4. _authorizeSlotWrite() gained the strict default; getAccessSlots() + the bounds getters
    ///      joined the interface.
    ///   5. `activeCount` dropped from AccessVaultStorage — it was always == slotIds.length, so it
    ///      cost a cold SSTORE per new slot for a number the array already knew (measured: ~22.2k off
    ///      every access-slot write; the binary-vs-JSON saving was unmoved at ~66.6k, as expected,
    ///      since both envelopes paid it).
    ///
    /// ⚠️ (5) IS A STORAGE-LAYOUT CHANGE, and the only one here that is not backwards compatible. The
    /// struct sits at a FIXED ERC-7201 root, so removing a field shifts every field after it: a wallet
    /// that wrote slots under the OLD layout and re-delegates to THIS implementation would read
    /// slotIds from where activeCount lived. It would fail SILENTLY — slotIds.length would read the
    /// old activeCount and be coincidentally correct. Taken deliberately, on the basis that nothing
    /// live depends on the old layout (0x59f9…54A8 was pending re-deploy and never carried funds).
    /// If that is ever untrue again, this is not a change to repeat.
    ///
    /// NOT changed: the ERC-7201 root itself (0xa4fa…0600). Only the struct within it moved.
    address internal constant GOLDEN_CANONICAL = 0x11c840C10e641f00f6874Fc909eD2Dc5dc31f68C;

    function test_predicted0x4e59AddressIsFixedNonZeroAndMatchesGolden() public {
        bytes32 codehash = keccak256(type(AvokWalletImplementation).creationCode);
        address predicted = vm.computeCreate2Address(SALT, codehash, CREATE2_DEPLOYER);
        assertTrue(predicted != address(0), "predicted address must be non-zero");
        assertEq(predicted, GOLDEN_CANONICAL, "0x4e59 CREATE2 prediction drifted from golden");
    }

    function test_create2DeployMatchesFormulaAndDeploysRuntimeCode() public {
        bytes32 codehash = keccak256(type(AvokWalletImplementation).creationCode);
        // Actual CREATE2 against the local test EVM (deployer = this test contract).
        AvokWalletImplementation impl = new AvokWalletImplementation{salt: SALT}();
        address expected = vm.computeCreate2Address(SALT, codehash, address(this));
        assertEq(address(impl), expected, "CREATE2 address must match the formula for this deployer");
        assertGt(address(impl).code.length, 0, "deployed code must be non-empty");
        assertEq(
            address(impl).code,
            type(AvokWalletImplementation).runtimeCode,
            "deployed code must equal AvokWalletImplementation.runtimeCode"
        );
    }
}
