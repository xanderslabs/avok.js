/**
 * Device roster management — `register`/`revoke` (`KeyManagement.sol`, exposed on `AvokCaliburABI`).
 *
 * Both are `onlyThis`: the contract only accepts them from itself. That is satisfied the SAME way
 * every other wallet action is — by wrapping the call in the wallet's own `execute(mode,
 * executionData)` batch (ERC-7821), so the inner call's `msg.sender` is the wallet contract calling
 * itself. This module therefore builds an ordinary `{to, value, data}` `Call` targeting the wallet's
 * OWN address; there is no new signing primitive and no new channel kind. Submitting it goes through
 * whatever this SDK already uses to send a batch — the announced EIP-1193 provider, same as any other
 * wallet action (VISION §6 "sending and signing go through the provider").
 *
 * Only Secp256k1 device keys are built here — every device this SDK enrolls derives a secp256k1 key
 * (D8), so P256/WebAuthnP256 `KeyType`s never appear on this path.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { AvokCaliburABI } from "@avokjs/contracts";
import { computeSecp256k1KeyHash } from "./roster-signature.js";
import type { Call } from "./types.js";

/** `KeyType.Secp256k1` — see `roster-signature.ts`'s matching constant. */
const KEY_TYPE_SECP256K1 = 2;

/** Build the self-call that registers `deviceAddress` as a new Secp256k1 signer on `wallet`'s roster.
 *  `wallet` is both the call's `to` and, once submitted, the caller Calibur sees — the self-call
 *  pattern `CaliburApi.t.sol`'s `test_RegisterSucceedsViaSelfCall` exercises. */
export function buildRegisterDeviceCall(wallet: Address, deviceAddress: Address): Call {
  const data = encodeFunctionData({
    abi: AvokCaliburABI,
    functionName: "register",
    args: [{ keyType: KEY_TYPE_SECP256K1, publicKey: deviceAddress }],
  });
  return { to: wallet, value: 0n, data };
}

/** Build the self-call that revokes a registered device by its key hash. Housekeeping, not a
 *  security control — see `wallet/device-enrollment.ts`'s module header for the same caveat applied
 *  to enrollment: a device that ever signed had the key, and revoking it here only stops FUTURE use. */
export function buildRevokeDeviceCall(wallet: Address, keyHash: Hex): Call {
  const data = encodeFunctionData({ abi: AvokCaliburABI, functionName: "revoke", args: [keyHash] });
  return { to: wallet, value: 0n, data };
}

/** The key hash a freshly-registered device's own address will be found under — what a
 *  `useDevices`-style caller diffs the roster against to confirm registration landed. */
export { computeSecp256k1KeyHash as deviceKeyHash };
