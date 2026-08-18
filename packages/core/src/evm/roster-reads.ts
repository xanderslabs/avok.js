/**
 * Reads against the wallet's own key roster (`KeyManagement.sol`, exposed on `AvokCaliburABI`) — the
 * counterpart to `roster-calls.ts`'s writes. Read directly against the WALLET's address: `keyCount`/
 * `keyAt` are ordinary Calibur view functions, not a delegatecall-only surface like GuardianLogic, but
 * they still only mean anything asked of the wallet contract itself.
 */
import { AvokCaliburABI } from "@avokjs/contracts";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import type { RpcClient } from "./rpc.js";

export interface RosterEntry {
  keyHash: Hex;
  /** `KeyType` — 0 P256, 1 WebAuthnP256, 2 Secp256k1. Every device this SDK enrolls is Secp256k1 (D8);
   *  other values can only appear if something outside this SDK registered a key directly. */
  keyType: number;
  /** Secp256k1 only: the device's own address, decoded from the key's `publicKey` field. */
  address?: Address;
}

/** Mirrors `KeyLib.hash`'s formula so a caller can match a roster entry to
 *  `roster-calls.ts`'s `deviceKeyHash` output without a second round trip per entry. */
function hashKey(keyType: number, publicKey: Hex): Hex {
  const publicKeyHash = keccak256(publicKey);
  return keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "bytes32" }], [keyType, publicKeyHash]));
}

/** Every key currently registered on `wallet`'s roster — the founding device's own address is NOT
 *  included: it is the "root key" (`KeyLib.ROOT_KEY_HASH`, `bytes32(0)`), which never occupies a slot
 *  in this enumerable set and carries no roster entry to read. */
export async function readDeviceRoster(rpc: RpcClient, wallet: Address): Promise<RosterEntry[]> {
  const count = await rpc.readContract<bigint>({
    address: wallet,
    abi: AvokCaliburABI,
    functionName: "keyCount",
  });

  const entries: RosterEntry[] = [];
  for (let i = 0n; i < count; i++) {
    const [keyType, publicKey] = await rpc.readContract<[number, Hex]>({
      address: wallet,
      abi: AvokCaliburABI,
      functionName: "keyAt",
      args: [i],
    });
    const entry: RosterEntry = { keyHash: hashKey(keyType, publicKey), keyType };
    if (keyType === 2 && publicKey.length === 66) {
      // Secp256k1's publicKey is abi.encode(address) — a 32-byte word with the address right-aligned
      // in the low 20 bytes. viem returns it as the full abi-encoded hex; slice to just the address.
      entry.address = `0x${publicKey.slice(-40)}` as Address;
    }
    entries.push(entry);
  }
  return entries;
}
