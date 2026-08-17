/**
 * Roster-signer signature wrapping (D8 + Calibur's key model).
 *
 * A wallet's FOUNDING device's own key IS the wallet's EIP-7702 delegate address — Calibur calls this
 * the "root key" and accepts a bare 64/65-byte ECDSA signature for it (`isRawSignature` in
 * WrappedSignatureLib.sol). Every device enrolled LATER (`wallet/device-enrollment.ts`) has its own
 * independent key, registered on chain as a roster entry keyed by `keccak256(abi.encode(Secp256k1,
 * keccak256(abi.encode(deviceAddress))))` (`KeyLib.hash`/`KeyLib.toKeyHash` in KeyLib.sol) — a
 * signature from that device must name which registered key it is, or Calibur has no way to tell it
 * apart from an arbitrary 64/65-byte string and would (correctly) reject it as unrecognized.
 *
 * TWO paths need this wrapping, and one deliberately does NOT:
 *   - `execute(bytes32 mode, bytes executionData)` (native-gas sends) needs NOTHING extra: Calibur
 *     authorizes by CALLER IDENTITY (`_isOwnerOrValidKey(msg.sender.toKeyHash())`), so a roster
 *     device just broadcasts an ordinary transaction with `to` set to the WALLET's address — the
 *     transaction's own outer ECDSA signature already IS the proof, exactly as it is for the
 *     founding device. No wrapping, no change from today's signing path.
 *   - `validateUserOp` (the sponsored/4337 rail) explicitly branches: a raw signature validates only
 *     against the root key; anything else must decode as `abi.encode(bytes32 keyHash, bytes
 *     signature, bytes hookData)` and is checked against that specific registered key
 *     (`KeyLib.verify`, a plain `ecrecover` for a Secp256k1 key — no ERC-7739 involved on this path).
 *     `wrapRosterSignature` below produces exactly that envelope.
 *   - `isValidSignature` (ERC-1271 — the path behind `signMessage`/`signTypedData`/`signSiwe`) is
 *     DELIBERATELY NOT handled here for a roster signer. Its non-root branch requires an ERC-7739
 *     nested-typed-data signature (`_isValidTypedDataSig`/`_isValidNestedPersonalSig` in
 *     Calibur.sol), not a plain wrapped ECDSA signature — a materially different, more involved
 *     scheme this module does not implement. A roster signer calling those three verbs today
 *     produces a signature Calibur will not recognize; that limitation is intentional and tracked,
 *     not silently wrong. Only the founding (root-key) device can use them until ERC-7739 support
 *     lands.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/** `KeyType.Secp256k1` in KeyLib.sol's `enum KeyType { P256, WebAuthnP256, Secp256k1 }`. */
const KEY_TYPE_SECP256K1 = 2;

/**
 * Mirrors `KeyLib.hash`/`KeyLib.toKeyHash` exactly: for a Secp256k1 key, `publicKey` is
 * `abi.encode(address)` and the hash is `keccak256(abi.encode(keyType, keccak256(publicKey)))`.
 * `toKeyHash(caller)` in KeyLib.sol computes this same formula for any non-root caller address —
 * this is the client-side mirror of that, used to name the key a wrapped signature is over.
 */
export function computeSecp256k1KeyHash(address: Address): Hex {
  const publicKey = encodeAbiParameters([{ type: "address" }], [address]);
  const publicKeyHash = keccak256(publicKey);
  return keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "bytes32" }], [KEY_TYPE_SECP256K1, publicKeyHash]));
}

/**
 * Wrap a raw ECDSA signature for a roster (non-root) key so Calibur's `validateUserOp` recognizes
 * which registered key it is over: `abi.encode(bytes32 keyHash, bytes signature, bytes hookData)`
 * (`WrappedSignatureLib.decodeWithKeyHashAndHookData`). `hookData` is always empty here — no hook is
 * configured on a freshly registered key.
 */
export function wrapRosterSignature(signerAddress: Address, rawSignature: Hex): Hex {
  const keyHash = computeSecp256k1KeyHash(signerAddress);
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes" }, { type: "bytes" }],
    [keyHash, rawSignature, "0x"],
  );
}
