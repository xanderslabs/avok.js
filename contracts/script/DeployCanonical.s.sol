// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Script, console2} from "forge-std/Script.sol";
import {AvokWalletImplementation} from "../src/AvokWalletImplementation.sol";

/// @notice Deterministic CREATE2 deploy of the canonical AvokWalletImplementation.
///
/// FUND-CRITICAL. Every Avok wallet delegates (EIP-7702) to the address produced
/// here. `AvokWalletImplementation` has no constructor and no immutables, so its
/// creation bytecode is fixed; a CREATE2 with a fixed salt through the same
/// deployer therefore yields the SAME address on every EVM chain.
///
/// This does NOT replace `Deploy.s.sol` (plain nonce-based CREATE, per-chain
/// address) — it is the additive deterministic path used for the canonical
/// cross-chain implementation.
contract DeployCanonicalAvokWallet is Script {
    /// @dev Standard cross-chain CREATE2 deployer (Arachnid deterministic-deployment-proxy).
    /// Deployed at this same address on essentially every EVM chain, incl. Arc. A forge
    /// broadcast routes `new X{salt}()` through this deployer, giving a chain-uniform address.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev FIXED canonical salt. CHANGING THIS CHANGES THE canonicalImplementation ADDRESS ON
    /// EVERY EVM CHAIN — never modify once deployed to a chain anyone relies on (wallets already
    /// delegating to the old address would be orphaned).
    ///
    /// DELIBERATELY UNVERSIONED. The salt used to carry a version ("…canonical.v5") to guarantee
    /// that two implementation revisions could never share an address. That guarantee was already
    /// unconditional and the version was doing nothing: IMPLEMENTATION_VERSION is a string constant
    /// INSIDE the contract, so any revision changes the creation bytecode, and CREATE2 hashes the
    /// bytecode — two different implementations CANNOT collide even under an identical salt. The
    /// version in the salt was guarding an access slot that cannot be opened, at the cost of one more
    /// number to keep in sync (and it had already drifted: the deploy script's own verify command
    /// still said v4 while the salt said v5).
    bytes32 internal constant SALT = keccak256("avok.wallet.canonical");

    function run() external returns (AvokWalletImplementation implementation) {
        // Predict independently from the deployer + salt + creation-code hash.
        bytes32 initCodeHash = keccak256(type(AvokWalletImplementation).creationCode);
        address predicted = vm.computeCreate2Address(SALT, initCodeHash, CREATE2_DEPLOYER);

        vm.startBroadcast();
        // In a forge broadcast, `new X{salt}()` is routed through CREATE2_DEPLOYER (0x4e59...).
        implementation = new AvokWalletImplementation{salt: SALT}();
        vm.stopBroadcast();

        console2.log("Predicted canonicalImplementation:", predicted);
        console2.log("Deployed  canonicalImplementation:", address(implementation));

        // Fail loud if the toolchain ever deviates from the CREATE2 prediction.
        require(address(implementation) == predicted, "DeployCanonical: deployed != CREATE2 prediction");
    }
}
