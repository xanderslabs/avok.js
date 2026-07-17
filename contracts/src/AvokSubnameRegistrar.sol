// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INameWrapper} from "./interfaces/INameWrapper.sol";
import {IAddrResolver} from "./interfaces/IAddrResolver.sol";

/// @title AvokSubnameRegistrar
/// @notice Operator-deployed controller that mints `label.parent` ENS subnames to users.
/// Default gate = an EIP-712 voucher signed by the operator, binding {label, owner, expiry}.
/// Open-claim (first-come, no voucher) is an opt-in constructor flag. The parent name's owner
/// delegates minting rights to this contract on the ENS NameWrapper. ENSv2-ready: NameWrapper
/// is the only ENS coupling — a native per-name registry drops in behind the same entry points.
///
/// Each mint sets the subname's resolver AND the forward `addr` record to the user's wallet, so
/// the name resolves both ways immediately — forward (name→address) here, reverse (address→name)
/// via the ENSIP-19 primary the client sets. Without the forward record a reverse lookup can't
/// be confirmed, so the name would not display.
contract AvokSubnameRegistrar is EIP712, Ownable2Step {
    using SafeERC20 for IERC20;

    bytes32 private constant VOUCHER_TYPEHASH = keccak256("Voucher(string label,address owner,uint64 expiry)");

    INameWrapper public immutable nameWrapper;
    bytes32 public immutable parentNode;
    address public immutable voucherSigner;
    address public immutable resolver;
    bool public immutable openClaim;
    uint32 public immutable fuses;

    // ── Mint fee (operator-updatable; free when price == 0) ─────────────────────
    IERC20 public feeToken;
    uint256 public price;
    address public treasury;

    event FeeConfigured(address token, uint256 price, address treasury);
    event MintFeeCharged(address indexed payer, address token, uint256 amount, address treasury);

    /// @dev Subnames are minted with the maximum expiry (NameWrapper clamps it to the parent's own
    /// expiry), so an subname lives exactly as long as the parent domain and never lapses early.
    /// A lapsed subname's node returns owner 0 and becomes re-claimable by anyone — for a name that
    /// IS a wallet's identity, that is an impersonation vector, so early expiry is not offered.
    uint64 private constant MAX_EXPIRY = type(uint64).max;

    event SubnameMinted(bytes32 indexed node, string label, address indexed owner);

    error VoucherExpired();
    error BadVoucherSigner();
    error OpenClaimDisabled();
    error EmptyLabel();
    error LabelTaken();

    constructor(
        INameWrapper _nameWrapper,
        bytes32 _parentNode,
        address _voucherSigner,
        address _resolver,
        bool _openClaim,
        uint32 _fuses,
        address _initialOwner
    ) EIP712("AvokSubnameRegistrar", "1") Ownable(_initialOwner) {
        nameWrapper = _nameWrapper;
        parentNode = _parentNode;
        voucherSigner = _voucherSigner;
        resolver = _resolver;
        openClaim = _openClaim;
        fuses = _fuses;
    }

    /// @notice Operator sets the ERC-20 mint fee (price 0 ⇒ free). Owner-gated.
    function setFee(IERC20 _feeToken, uint256 _price) external onlyOwner {
        feeToken = _feeToken;
        price = _price;
        emit FeeConfigured(address(_feeToken), _price, treasury);
    }

    /// @notice Operator sets the fee recipient. Owner-gated.
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit FeeConfigured(address(feeToken), price, _treasury);
    }

    /// @notice Current mint-fee config (one call for clients/preview).
    function mintFee() external view returns (address token, uint256 amount, address recipient) {
        return (address(feeToken), price, treasury);
    }

    /// @dev Pull the configured fee from the caller (the user's wallet) before minting. No-op when free.
    function _charge() internal {
        uint256 p = price;
        if (p == 0 || address(feeToken) == address(0)) return;
        require(treasury != address(0), "AvokSubnameRegistrar: treasury unset");
        feeToken.safeTransferFrom(msg.sender, treasury, p);
        emit MintFeeCharged(msg.sender, address(feeToken), p, treasury);
    }

    /// @notice Mint `label.parent` to `owner`, gated by an operator EIP-712 voucher.
    function registerWithVoucher(string calldata label, address owner_, uint64 voucherExpiry, bytes calldata signature)
        external
    {
        if (voucherExpiry < block.timestamp) revert VoucherExpired();
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, keccak256(bytes(label)), owner_, voucherExpiry));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != voucherSigner) revert BadVoucherSigner();
        _mint(label, owner_);
    }

    /// @notice First-come mint to the caller. Only when the operator enabled open-claim.
    function claim(string calldata label) external {
        if (!openClaim) revert OpenClaimDisabled();
        _mint(label, msg.sender);
    }

    function _mint(string calldata label, address owner_) internal {
        _charge();
        if (bytes(label).length == 0) revert EmptyLabel();
        bytes32 node = keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
        if (nameWrapper.ownerOf(uint256(node)) != address(0)) revert LabelTaken();

        // 1. Mint to the registrar with the resolver set, so we can write the addr record.
        nameWrapper.setSubnodeRecord(parentNode, label, address(this), resolver, 0, fuses, MAX_EXPIRY);
        // 2. Forward record: name → the user's wallet (required for reverse resolution to confirm).
        IAddrResolver(resolver).setAddr(node, owner_);
        // 3. Hand ownership to the user — the name is theirs; the resolver record persists.
        nameWrapper.setSubnodeOwner(parentNode, label, owner_, fuses, MAX_EXPIRY);

        emit SubnameMinted(node, label, owner_);
    }
}
