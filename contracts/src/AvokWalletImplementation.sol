// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {PasskeyAccessVault} from "./PasskeyAccessVault.sol";
import {IPasskeyAccessVault} from "./interfaces/IPasskeyAccessVault.sol";
import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @title AvokWalletImplementation
/// @notice Immutable EIP-7702 delegation target for Avok wallets. Under EIP-7702
/// `address(this)` is the user's EOA at runtime. Dual-mode account: an ERC-7821 self-pay batch
/// executor plus an ERC-4337 (EntryPoint v0.8) `validateUserOp` path for sponsored sends.
///
/// STORAGE-LAYOUT FREEZE (upgrade discipline): each wallet is its own EOA storage under
/// EIP-7702; re-pointing the delegation to a new implementation version REUSES that storage.
/// So the storage layout below is APPEND-ONLY across versions — never reorder, retype, or
/// remove a state variable in a way that shifts an existing slot, or a wallet carrying an
/// older version's storage would misread it. New state goes at the end. Any layout-breaking
/// change MUST bump the major of IMPLEMENTATION_VERSION (a codeless signal for tooling/ops),
/// and, because this contract is deployed deterministically (CREATE2), it lands at a new
/// canonical address the registry must be re-pointed to.
contract AvokWalletImplementation is ERC721Holder, ERC1155Holder, IERC1271, IAccount, PasskeyAccessVault {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    /// @dev The ONE version number for this implementation. 0.x while the ERC is a Draft and the
    /// code is UNAUDITED; bump to 1.0.0 at ERC Final, after audit. It matches BLOB_VERSION = 0
    /// (also Draft) deliberately — the two used to disagree, with the blob honestly at Draft-0 while
    /// the contract claimed a 5.0.0 that had never been released to anyone.
    ///
    /// Nothing reads this. It is a label for tooling and ops, NOT a consensus input: no signature,
    /// digest, or type hash depends on it (see EIP712_VERSION, which is the one that does and is
    /// frozen). It is not needed to separate deployments either — this string lives IN the bytecode,
    /// so any change to it already moves the CREATE2 address on its own.
    string public constant IMPLEMENTATION_VERSION = "AvokWalletImplementation/0.1.0";

    bytes32 internal constant MODE_BATCH =
        0x0100000000000000000000000000000000000000000000000000000000000000;
    bytes32 internal constant MODE_BATCH_OPDATA =
        0x0100000000007821000100000000000000000000000000000000000000000000;

    /// @dev ERC-4337 EntryPoint v0.8 canonical singleton (same address on every chain it is
    /// deployed to). Verified against eth-infinitism/account-abstraction v0.8.0. v0.8 signs the
    /// userOpHash as an EIP-712 hash directly, so validation needs no new typed data here.
    address internal constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CALL_TYPEHASH = keccak256("Call(address to,uint256 value,bytes data)");
    bytes32 private constant EXECUTE_BATCH_TYPEHASH = keccak256(
        "ExecuteBatch(Call[] calls,uint256 nonce,uint256 deadline)Call(address to,uint256 value,bytes data)"
    );

    // EIP-712 domain identity. Distinct from IMPLEMENTATION_VERSION: this "1" is frozen because
    // changing it would invalidate every previously-signed intent.
    string private constant EIP712_NAME = "AvokWallet";
    string private constant EIP712_VERSION = "1";

    bytes4 private constant ERC1271_INVALID = 0xffffffff;

    // ── Storage (append-only; see STORAGE-LAYOUT FREEZE above) ──────────────────
    // Unordered nonce bitmap (Permit2-style). A 256-bit intent nonce splits into
    // word = nonce >> 8 and bit = nonce & 0xff; consuming it sets that bit. Each of the 2^256
    // nonce values is still single-use, so the replay guarantee (and the relayer's opaque
    // single-use-nonce double-submit backstop) is IDENTICAL to a plain mapping. The difference is
    // storage density: 256 nonces share one word. A client that picks nonces at random gets the
    // same cost/storage as a plain mapping (one word per nonce); a client that CLUSTERS nonces
    // (sequential within a word) gets ~4x cheaper repeat writes (warm word) and 256x denser storage
    // — the escape hatch for L1 / expensive-storage deployments where the per-nonce cold SSTORE bites.
    mapping(uint256 word => uint256 bitmap) public nonceBitmap;

    // `Unauthorized()` is inherited from IPasskeyAccessVault — it is standard now, so a client decodes
    // the same selector from any conforming implementation. Same selector as the local one it replaces.
    error EmptyBatch();
    error UnsupportedExecutionMode();
    error Expired();
    error NonceUsed();
    error InvalidSignature();

    receive() external payable {}

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return _recover(hash, signature) == address(this) ? IERC1271.isValidSignature.selector : ERC1271_INVALID;
    }

    /// @dev IPasskeyAccessVault is advertised here because it is the whole point: the standard exists to
    ///      be implemented by others, and until now nothing on chain could ask a contract "are you a
    ///      Passkey Access Vault?" — including this one, the reference deployment. A wallet that cannot
    ///      be detected as conforming is one that tooling must special-case by address.
    function supportsInterface(bytes4 interfaceId) public view override(ERC1155Holder) returns (bool) {
        return interfaceId == type(IPasskeyAccessVault).interfaceId
            || interfaceId == type(IERC1271).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId
            || super.supportsInterface(interfaceId);
    }

    function implementationVersion() external pure returns (string memory) {
        return IMPLEMENTATION_VERSION;
    }

    /// @notice EIP-5267 domain introspection so wallets/tooling can reconstruct the EIP-712 domain.
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (hex"0f", EIP712_NAME, EIP712_VERSION, block.chainid, address(this), bytes32(0), new uint256[](0));
    }

    function supportsExecutionMode(bytes32 mode) external pure returns (bool) {
        return mode == MODE_BATCH || mode == MODE_BATCH_OPDATA;
    }

    function execute(bytes32 mode, bytes calldata executionData) external payable {
        if (mode == MODE_BATCH) {
            // Self-call (7702 self-pay) OR the EntryPoint forwarding a validated UserOp's callData.
            if (msg.sender != address(this) && msg.sender != ENTRY_POINT) revert Unauthorized();
            _execute(abi.decode(executionData, (Call[])));
        } else if (mode == MODE_BATCH_OPDATA) {
            _executeWithOpData(executionData);
        } else {
            revert UnsupportedExecutionMode();
        }
    }

    /// @notice ERC-4337 v0.8 validation. K IS the EOA key, so a valid UserOp is one the account
    /// itself signed: `ecrecover(userOpHash) == address(this)`. Returns 0 (valid) or 1
    /// (SIG_VALIDATION_FAILED); no time-range packing. Only the EntryPoint may call it. When the
    /// EntryPoint reports missing deposit, forward exactly that prefund to it (best-effort per 4337;
    /// the EntryPoint checks the actual deposit).
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external
        returns (uint256 validationData)
    {
        if (msg.sender != ENTRY_POINT) revert Unauthorized();
        validationData = _recover(userOpHash, userOp.signature) == address(this) ? 0 : 1;
        if (missingAccountFunds != 0) {
            // slither-disable-next-line low-level-calls -- prefund transfer to the EntryPoint; failure is ignored per ERC-4337 (the EntryPoint re-checks the deposit).
            (bool ok,) = msg.sender.call{value: missingAccountFunds}("");
            ok; // silence unused; EntryPoint validates the actual deposit
        }
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH, keccak256(bytes(EIP712_NAME)), keccak256(bytes(EIP712_VERSION)), block.chainid, address(this)
        ));
    }

    function hashExecuteBatch(Call[] calldata calls, uint256 nonce, uint256 deadline) external view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(EXECUTE_BATCH_TYPEHASH, _hashCalls(calls), nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _hashCalls(Call[] memory calls) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](calls.length);
        for (uint256 i; i < calls.length;) {
            hashes[i] = keccak256(abi.encode(CALL_TYPEHASH, calls[i].to, calls[i].value, keccak256(calls[i].data)));
            unchecked { ++i; }
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _recover(bytes32 digest, bytes memory signature) private pure returns (address) {
        (address rec, ECDSA.RecoverError err, bytes32 errArg) = ECDSA.tryRecover(digest, signature);
        if (errArg != bytes32(0)) return address(0);
        return err == ECDSA.RecoverError.NoError ? rec : address(0);
    }

    /// @notice Whether an intent nonce has been consumed. Reads the bit in the nonce's word — the
    /// same boolean the previous `nonceUsed` mapping exposed, over the denser bitmap encoding.
    function nonceUsed(uint256 nonce) external view returns (bool) {
        return nonceBitmap[nonce >> 8] & (uint256(1) << (nonce & 0xff)) != 0;
    }

    function _consume(uint256 nonce, uint256 deadline) private {
        // slither-disable-next-line timestamp -- coarse signed-intent expiry; ~12s validator influence is harmless.
        if (block.timestamp > deadline) revert Expired();
        uint256 word = nonce >> 8;
        uint256 mask = uint256(1) << (nonce & 0xff);
        uint256 bits = nonceBitmap[word];
        if (bits & mask != 0) revert NonceUsed();
        nonceBitmap[word] = bits | mask;
    }

    function _executeWithOpData(bytes calldata executionData) internal {
        (Call[] memory calls, bytes memory opData) = abi.decode(executionData, (Call[], bytes));
        (uint256 nonce, uint256 deadline, bytes memory signature) = abi.decode(opData, (uint256, uint256, bytes));
        bytes32 structHash = keccak256(abi.encode(EXECUTE_BATCH_TYPEHASH, _hashCalls(calls), nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        if (_recover(digest, signature) != address(this)) revert InvalidSignature();
        _consume(nonce, deadline);
        _execute(calls);
    }

    function _execute(Call[] memory calls) internal {
        if (calls.length == 0) revert EmptyBatch();
        for (uint256 i; i < calls.length;) {
            // slither-disable-next-line arbitrary-send-eth,low-level-calls,calls-loop -- target/value/data are owner-signed (EIP-712, nonce+deadline) or self-authorized; raw call required to forward value + arbitrary calldata.
            (bool ok, bytes memory ret) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) {
                // slither-disable-next-line assembly -- memory-safe bubble of inner revert data.
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
            unchecked { ++i; }
        }
    }

    // ── Passkey access vault ───────────────────────────────────────────────────
    // Implemented by the inherited PasskeyAccessVault mixin, whose storage is ERC-7201 namespaced
    // and therefore NOT part of the append-only layout above — that is deliberate: the namespace is
    // what lets a wallet re-delegate to another vendor's conforming implementation without its
    // access slots being reinterpreted at whatever those positions mean there.

    /// @dev EIP-7702: the delegate runs as the account itself, so a self-call IS the account acting.
    function _authorizeSlotWrite() internal view override {
        if (msg.sender != address(this)) revert Unauthorized();
    }
}
