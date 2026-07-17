// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {BaseTest} from "./Base.t.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @notice `validateUserOp` is the ERC-4337 v0.8 half of the dual-mode account.
/// Since K IS the EOA key, validation is a plain ecrecover of the (already EIP-712)
/// userOpHash against `address(this)` — no new typed data.
contract ValidateUserOpTest is BaseTest {
    // v0.8 canonical EntryPoint singleton (verified against eth-infinitism/account-abstraction v0.8.0).
    address internal constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    uint256 internal constant wrongPk = 0xB0B;

    function _op(bytes memory signature) internal view returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: wallet,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }

    function test_validSigner_returns0() public {
        bytes32 userOpHash = keccak256("userOpHash");
        PackedUserOperation memory op = _op(signDigest(userOpHash));
        vm.prank(ENTRY_POINT);
        uint256 v = w().validateUserOp(op, userOpHash, 0);
        assertEq(v, 0, "valid signer must return 0");
    }

    function test_wrongSigner_returns1() public {
        bytes32 userOpHash = keccak256("userOpHash");
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(wrongPk, userOpHash);
        PackedUserOperation memory op = _op(abi.encodePacked(sr, ss, sv));
        vm.prank(ENTRY_POINT);
        uint256 v = w().validateUserOp(op, userOpHash, 0);
        assertEq(v, 1, "wrong signer must return SIG_VALIDATION_FAILED (1)");
    }

    function test_prefund_transfersExactlyMissingFunds() public {
        bytes32 userOpHash = keccak256("userOpHash");
        PackedUserOperation memory op = _op(signDigest(userOpHash));
        uint256 missing = 0.5 ether;
        uint256 epBefore = ENTRY_POINT.balance;
        uint256 walletBefore = wallet.balance;

        vm.prank(ENTRY_POINT);
        w().validateUserOp(op, userOpHash, missing);

        assertEq(ENTRY_POINT.balance, epBefore + missing, "EntryPoint must receive exactly missingAccountFunds");
        assertEq(wallet.balance, walletBefore - missing, "wallet must be debited exactly missingAccountFunds");
    }

    function test_nonEntryPointCaller_reverts() public {
        bytes32 userOpHash = keccak256("userOpHash");
        PackedUserOperation memory op = _op(signDigest(userOpHash));
        vm.prank(address(0xdead));
        vm.expectRevert();
        w().validateUserOp(op, userOpHash, 0);
    }
}
