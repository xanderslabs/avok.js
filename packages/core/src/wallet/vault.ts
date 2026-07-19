import { bytesToHex, encodeFunctionData, type Address, type Hex } from "viem";

/** A single on-chain call. The Tx Engine assembles these into a batch. */
export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
}

/**
 * The access-slot vault this SDK consumes from the account contract (IPasskeyAccessVault).
 * The blob is stored as `bytes`: the canonical 61-byte envelope, never JSON.
 *
 * `removeAccessSlot` removes an access slot and frees it — the enumerable index + per-slot enrollment date
 * make it aimable (a wallet can list its access slots and pick one). It is housekeeping, NOT a security
 * control — see buildRemoveAccessSlotCall and the invariant in test/public-api.test.ts.
 */
export const ACCESS_VAULT_ABI = [
  {
    type: "function",
    name: "addAccessSlot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "slotId", type: "bytes32" },
      { name: "encryptedBlob", type: "bytes" },
      { name: "encryptedMeta", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getAccessSlotMeta",
    stateMutability: "view",
    inputs: [{ name: "slotId", type: "bytes32" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "getAccessSlot",
    stateMutability: "view",
    inputs: [{ name: "slotId", type: "bytes32" }],
    outputs: [
      { name: "encryptedBlob", type: "bytes" },
      { name: "active", type: "bool" },
      { name: "version", type: "uint64" },
      { name: "addedAt", type: "uint64" },
    ],
  },
  { type: "function", name: "getAccessSlotIds", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32[]" }] },
  {
    type: "function",
    name: "removeAccessSlot",
    stateMutability: "nonpayable",
    inputs: [{ name: "slotId", type: "bytes32" }],
    outputs: [],
  },
  { type: "function", name: "accessSlotCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/**
 * The chain did NOT answer. This is not evidence that a slot is absent — it is evidence of nothing.
 *
 * A reader MUST throw this on a failed read, and return `null` ONLY for a read that succeeded and found
 * no active slot. Collapsing the two (a `catch { return null }`) makes an ORPHANED credential — a
 * passkey whose slot write never landed — indistinguishable from an RPC blip, which is exactly why
 * orphans used to be invisible rather than merely unrepaired.
 */
export class VaultUnreadableError extends Error {
  constructor(cause?: unknown) {
    super("Could not read the access-slot vault from the chain.");
    this.name = "VaultUnreadableError";
    this.cause = cause;
  }
}

/** Read side of the vault. Resolution needs only `getAccessSlot` — slots are keyed by the
 *  deterministic slotId, so there is no enumeration. `accessSlotCount` is optional: readers used
 *  purely for resolution (e.g. the shared-origin origin) need not implement it. */
export interface VaultReader {
  /**
   * @returns the stored envelope, or `null` when the chain ANSWERED and there is no active slot — an
   *          orphan, positively established, and not retryable.
   * @throws  VaultUnreadableError when the chain did not answer. NEVER conflate the two.
   */
  getAccessSlot(address: Address, slotId: Hex): Promise<Uint8Array | null>;
  accessSlotCount?(address: Address): Promise<bigint>;
}

/** `encryptedMeta` is the access slot's opaque metadata ciphertext (the enrolling rp-id, encrypted under a
 *  K-derived key by wallet-core). It is public on chain, so it is safe to hand around here; pass an
 *  empty array only where no rp-id is knowable. */
export function buildAddAccessSlotCall(args: {
  address: Address;
  slotId: Hex;
  encryptedBlob: Uint8Array;
  encryptedMeta: Uint8Array;
}): Call {
  return {
    to: args.address,
    value: 0n,
    data: encodeFunctionData({
      abi: ACCESS_VAULT_ABI,
      functionName: "addAccessSlot",
      args: [args.slotId, bytesToHex(args.encryptedBlob), bytesToHex(args.encryptedMeta)],
    }),
  };
}

/**
 * REMOVE AN ACCESS SLOT — free it. Housekeeping, NOT a security control, and no caller may present it as
 * one. The name is deliberate: it removes an access slot, it does not revoke access.
 *
 * WHY IT EXISTS: MAX_ACCESS_SLOTS is bounded (an unbounded array in account storage is a griefing
 * vector), so without this a wallet that fills its slots could never enrol another passkey. It also frees
 * the storage. That is the whole justification.
 *
 * WHY IT IS NOT SECURITY, stated plainly so nobody rebuilds the illusion:
 *  - It cannot un-learn the key. To SIGN, a passkey must materialise K in memory (that is what the
 *    sandbox does on every login). Any device that ever signed could have kept it, and nothing on
 *    chain un-copies it.
 *  - It cannot erase the blob. The blob was public calldata to addAccessSlot and lives in the chain's
 *    history forever — every full node keeps it, not just archive nodes. A domain that enrolled a passkey
 *    trivially archived it at the time.
 *  - It cannot be aimed by the honest party. Every passkey signs as the same K, so the contract cannot
 *    tell them apart: ANY passkey can close ANY other.
 *
 * IF A DEVICE IS COMPROMISED, MOVE THE FUNDS to a new wallet — both chains. Nothing else is sufficient.
 */
export function buildRemoveAccessSlotCall(args: { address: Address; slotId: Hex }): Call {
  return {
    to: args.address,
    value: 0n,
    data: encodeFunctionData({
      abi: ACCESS_VAULT_ABI,
      functionName: "removeAccessSlot",
      args: [args.slotId],
    }),
  };
}
