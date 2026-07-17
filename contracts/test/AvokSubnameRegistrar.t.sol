// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {AvokSubnameRegistrar} from "../src/AvokSubnameRegistrar.sol";
import {INameWrapper} from "../src/interfaces/INameWrapper.sol";
import {MockNameWrapper} from "./mocks/MockNameWrapper.sol";
import {MockResolver} from "./mocks/MockResolver.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockNoReturnERC20} from "./mocks/MockNoReturnERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AvokSubnameRegistrarTest is Test {
    MockNameWrapper wrapper;
    MockResolver resolver;
    AvokSubnameRegistrar registrar;
    uint256 signerKey = 0xA11CE;
    address operatorSigner;
    bytes32 parentNode = keccak256("qudiid.eth-node");
    address user = address(0xBEEF);

    bytes32 constant VOUCHER_TYPEHASH = keccak256("Voucher(string label,address owner,uint64 expiry)");

    function setUp() public {
        operatorSigner = vm.addr(signerKey);
        wrapper = new MockNameWrapper();
        resolver = new MockResolver();
        registrar = new AvokSubnameRegistrar(
            INameWrapper(address(wrapper)), parentNode, operatorSigner, address(resolver), false, 0, address(this)
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AvokSubnameRegistrar"),
                keccak256("1"),
                block.chainid,
                address(registrar)
            )
        );
    }

    function _sign(string memory label, address owner, uint64 voucherExpiry) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, keccak256(bytes(label)), owner, voucherExpiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_validVoucher_mintsUserOwnedSubname() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign("alice", user, exp);
        registrar.registerWithVoucher("alice", user, exp, sig);
        bytes32 node = keccak256(abi.encodePacked(parentNode, keccak256(bytes("alice"))));
        // Ownership lands on the user AND the forward addr record resolves to the user's wallet.
        assertEq(wrapper.ownerOf(uint256(node)), user);
        assertEq(resolver.addr(node), user);
        assertEq(wrapper.resolvers(uint256(node)), address(resolver));
    }

    function test_mintsWithMaxExpiry_soNamesDoNotLapse() public {
        // B1: subnames are minted at max expiry (NameWrapper clamps to the parent's) so an subname
        // never lapses into re-claimability — a lapsed name would let anyone re-mint and impersonate.
        uint64 exp = uint64(block.timestamp + 1 days);
        registrar.registerWithVoucher("alice", user, exp, _sign("alice", user, exp));
        bytes32 node = keccak256(abi.encodePacked(parentNode, keccak256(bytes("alice"))));
        assertEq(wrapper.expiries(uint256(node)), type(uint64).max);
    }

    function test_badSigner_reverts() public {
        uint256 wrongKey = 0xBAD;
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, keccak256(bytes("alice")), user, exp));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        vm.expectRevert(AvokSubnameRegistrar.BadVoucherSigner.selector);
        registrar.registerWithVoucher("alice", user, exp, abi.encodePacked(r, s, v));
    }

    function test_expiredVoucher_reverts() public {
        vm.warp(1000);
        bytes memory sig = _sign("alice", user, uint64(500));
        vm.expectRevert(AvokSubnameRegistrar.VoucherExpired.selector);
        registrar.registerWithVoucher("alice", user, uint64(500), sig);
    }

    function test_takenLabel_reverts() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        registrar.registerWithVoucher("alice", user, exp, _sign("alice", user, exp));
        vm.expectRevert(AvokSubnameRegistrar.LabelTaken.selector);
        registrar.registerWithVoucher("alice", address(0xF00D), exp, _sign("alice", address(0xF00D), exp));
    }

    function test_claim_revertsWhenOpenClaimDisabled() public {
        vm.expectRevert(AvokSubnameRegistrar.OpenClaimDisabled.selector);
        registrar.claim("alice");
    }

    function test_openClaim_mintsToCaller() public {
        AvokSubnameRegistrar open = new AvokSubnameRegistrar(
            INameWrapper(address(wrapper)), parentNode, operatorSigner, address(resolver), true, 0, address(this)
        );
        vm.prank(user);
        open.claim("carol");
        bytes32 node = keccak256(abi.encodePacked(parentNode, keccak256(bytes("carol"))));
        assertEq(wrapper.ownerOf(uint256(node)), user);
        assertEq(resolver.addr(node), user);
    }

    // ── Mint fee ────────────────────────────────────────────────────────────────
    address constant TREASURY = address(0x7EA5);

    function test_chargesErc20FeeOnVoucherMint() public {
        MockERC20 token = new MockERC20();
        token.mint(user, 1_000e6);
        registrar.setFee(IERC20(address(token)), 100e6);
        registrar.setTreasury(TREASURY);

        vm.prank(user);
        token.approve(address(registrar), 100e6);

        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign("ada", user, exp);
        vm.prank(user);
        registrar.registerWithVoucher("ada", user, exp, sig);

        assertEq(token.balanceOf(TREASURY), 100e6);
        assertEq(token.balanceOf(user), 900e6);
    }

    function test_freeTierWhenPriceZero() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign("bob", user, exp);
        vm.prank(user);
        registrar.registerWithVoucher("bob", user, exp, sig);
        (, uint256 price,) = registrar.mintFee();
        assertEq(price, 0);
    }

    function test_revertsWhenFeeUnpaid() public {
        MockERC20 token = new MockERC20();
        registrar.setFee(IERC20(address(token)), 100e6);
        registrar.setTreasury(TREASURY);
        token.mint(user, 100e6); // has balance but NO approval
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign("eve", user, exp);
        vm.prank(user);
        vm.expectRevert();
        registrar.registerWithVoucher("eve", user, exp, sig);
    }

    function test_setFeeAndTreasuryAreOwnerGated() public {
        MockERC20 token = new MockERC20();
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        registrar.setFee(IERC20(address(token)), 1);
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        registrar.setTreasury(TREASURY);
    }

    function test_chargesFeeOnOpenClaim() public {
        AvokSubnameRegistrar open = new AvokSubnameRegistrar(
            INameWrapper(address(wrapper)), parentNode, operatorSigner, address(resolver), true, 0, address(this)
        );
        MockERC20 token = new MockERC20();
        token.mint(user, 100e6);
        open.setFee(IERC20(address(token)), 100e6);
        open.setTreasury(TREASURY);
        vm.prank(user);
        token.approve(address(open), 100e6);
        vm.prank(user);
        open.claim("free1");
        assertEq(token.balanceOf(TREASURY), 100e6);
    }

    function test_handlesNonStandardErc20() public {
        MockNoReturnERC20 usdt = new MockNoReturnERC20();
        usdt.mint(user, 100e6);
        registrar.setFee(IERC20(address(usdt)), 100e6);
        registrar.setTreasury(TREASURY);
        vm.prank(user);
        usdt.approve(address(registrar), 100e6);
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _sign("usdtuser", user, exp);
        vm.prank(user);
        registrar.registerWithVoucher("usdtuser", user, exp, sig);
        assertEq(usdt.balanceOf(TREASURY), 100e6);
    }
}
