/**
 * A guardian's approval of a recovery — the EIP-712 `RecoveryApproval` signature
 * `GuardianLogic.sol`'s `_recoveryApprovalDigest` builds (domain "Avok Guardians" v1, verifyingContract
 * = the WALLET's own address since GuardianLogic runs by delegatecall), submitted through
 * `approveRecoveryBySig` — which anyone can relay, so a guardian never needs to pay gas or even stay
 * online after signing. Both branches below produce the SAME signed envelope; only how the signature
 * is produced differs.
 */
import { bytesToHex, hashTypedData, hexToBytes, numberToHex, serializeSignature, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const RECOVERY_APPROVAL_TYPES = {
  RecoveryApproval: [
    { name: "promoteKey", type: "address" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export interface RecoveryApprovalTypedData {
  domain: { name: "Avok Guardians"; version: "1"; chainId: number; verifyingContract: Address };
  types: typeof RECOVERY_APPROVAL_TYPES;
  primaryType: "RecoveryApproval";
  message: { promoteKey: Address; nonce: bigint };
}

/** Mirrors `GuardianLogic.sol#_recoveryApprovalDigest` exactly — same domain, same typehash, same
 *  struct encoding — so a signature over this typed data verifies against the contract's own digest. */
export function recoveryApprovalTypedData(args: {
  wallet: Address;
  chainId: number;
  promoteKey: Address;
  nonce: bigint;
}): RecoveryApprovalTypedData {
  return {
    domain: { name: "Avok Guardians", version: "1", chainId: args.chainId, verifyingContract: args.wallet },
    types: RECOVERY_APPROVAL_TYPES,
    primaryType: "RecoveryApproval",
    message: { promoteKey: args.promoteKey, nonce: args.nonce },
  };
}

/** What `approveRecoveryBySig(promoteKey, nonce, guardian, sig)` needs, ready to submit — submission
 *  itself is the caller's job (any relayer, or the vault's own send path once wired). */
export interface GuardianApproval {
  guardian: Address;
  promoteKey: Address;
  nonce: bigint;
  signature: Hex;
}

/**
 * Guardian path (a) — TDD §7 "connect-wallet": a guardian who has a real, connected wallet signs via
 * ITS OWN `eth_signTypedData_v4` (or equivalent) — standard EIP-712, no blind-signing, no key ever
 * touches the Vault. `signTypedData` is whatever that wallet's provider exposes; this function only
 * builds the exact typed data GuardianLogic will check the signature against.
 */
export async function approveAsConnectedGuardian(args: {
  guardian: Address;
  wallet: Address;
  chainId: number;
  promoteKey: Address;
  nonce: bigint;
  signTypedData: (typedData: RecoveryApprovalTypedData) => Promise<Hex>;
}): Promise<GuardianApproval> {
  const typedData = recoveryApprovalTypedData(args);
  const signature = await args.signTypedData(typedData);
  return { guardian: args.guardian, promoteKey: args.promoteKey, nonce: args.nonce, signature };
}

/**
 * Guardian path (b) — TDD §7 "key import": a guardian holds a raw secp256k1 private key (the
 * Vault-side one-shot recovery-key branch — PRD's `addGuardian` two-branch setup) rather than a
 * connected wallet. Materialize the account from the key bytes, sign, wipe — same derive/use/clear
 * discipline as `wallet/sandbox.ts`, applied to an IMPORTED key instead of a passkey-derived one.
 *
 * The caller's own copy of `args.privateKey` (a Hex STRING) cannot be wiped by this function — strings
 * are immutable in JS. This wipes every byte-array copy IT makes; the caller is responsible for not
 * retaining the string longer than the ceremony needs it.
 */
export async function approveWithImportedKey(args: {
  privateKey: Hex;
  wallet: Address;
  chainId: number;
  promoteKey: Address;
  nonce: bigint;
}): Promise<GuardianApproval> {
  const keyBytes = hexToBytes(args.privateKey);
  try {
    const publicKey = secp256k1.getPublicKey(keyBytes, false);
    const guardian = publicKeyToAddress(bytesToHex(publicKey));
    const typedData = recoveryApprovalTypedData({
      wallet: args.wallet,
      chainId: args.chainId,
      promoteKey: args.promoteKey,
      nonce: args.nonce,
    });
    const digest = hashTypedData(typedData);
    const recovered = secp256k1.sign(hexToBytes(digest), keyBytes, {
      lowS: true,
      extraEntropy: false,
      prehash: false,
      format: "recovered",
    });
    const sig = secp256k1.Signature.fromBytes(recovered, "recovered");
    const yParity = sig.recovery ?? 0;
    const signature = serializeSignature({
      r: numberToHex(sig.r, { size: 32 }),
      s: numberToHex(sig.s, { size: 32 }),
      v: yParity ? 28n : 27n,
      yParity,
    });
    return { guardian, promoteKey: args.promoteKey, nonce: args.nonce, signature };
  } finally {
    keyBytes.fill(0);
  }
}
