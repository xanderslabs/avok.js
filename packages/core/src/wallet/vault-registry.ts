import {
  BaseError,
  ContractFunctionZeroDataError,
  createPublicClient,
  hexToBytes,
  http,
  type Address,
  type Hex,
} from "viem";
import { evmRpcUrl, getChainProfile, type RpcOverrides } from "@avokjs/contracts";
import { ACCESS_VAULT_ABI, VaultUnreadableError, type VaultReader } from "./vault.js";
import type { RosterReader } from "./roster.js";

/**
 * The single source of truth for the read-only "resolve a secondary's blob from the chain its handle
 * marks" vault reader, built from the registry's default RPC. Shared by the own-origin connection's
 * vault-from-marker fallback, the shared-origin origin's wallet-state, and the shared-origin authorize popup —
 * three call sites that previously each inlined an identical viem reader.
 *
 * `getAccessSlot` returns null ONLY when the chain ANSWERED and there is no active slot. That is an
 * ORPHAN — a credential whose slot write never landed — and it is repairable through a surviving passkey,
 * never fixed by retrying. A read that FAILS throws VaultUnreadableError, which IS retryable and says
 * nothing at all about the wallet. (This file used to catch everything and return null, which made the
 * two indistinguishable and orphans invisible.) Only a secondary ever reaches this reader — a birth
 * credential derives K from its own PRF.
 *
 * The roster reads below stay lenient (empty list / zero on failure): a settings screen that cannot
 * load is cosmetic, while a blob that cannot load decides whether someone is locked out. The asymmetry
 * is deliberate.
 *
 * Throws when `chainId` is absent from the registry (no RPC to read its blob). Every caller guards that
 * case first with its own fail-loud error (SlotUnreachableError / a thrown Error), so this throw is a
 * defensive backstop, not the surfaced error.
 *
 * `overrides` lets the app read the blob through ITS chosen RPC rather than the registry's public
 * default — the same config-first rule as everywhere else (see contracts/rpc.ts). Recovering a wallet
 * is precisely when you do not want to be at the mercy of a rate-limited public endpoint.
 */
export function vaultForChainFromRegistry(chainId: number, overrides?: RpcOverrides): VaultReader & RosterReader {
  if (!getChainProfile(chainId) && !overrides?.evm?.[chainId]) {
    throw new Error(`Cannot reach this device's access slot: chain ${chainId} is not in the registry.`);
  }
  const client = createPublicClient({ transport: http(evmRpcUrl(chainId, overrides)) });
  return {
    async getAccessSlot(addr, slotId) {
      let raw: unknown;
      try {
        raw = await client.readContract({
          address: addr,
          abi: ACCESS_VAULT_ABI,
          functionName: "getAccessSlot",
          args: [slotId],
        });
      } catch (e) {
        // Two very different facts arrive here as the SAME error name (ContractFunctionExecutionError),
        // so we must inspect the CAUSE CHAIN. Measured against the pinned viem:
        //
        //   ZERO DATA  -> the address returned nothing to decode. Either it has no code (a wallet not
        //                 yet delegated — every fresh wallet, until its first tx) or it is delegated to
        //                 an implementation with no vault. Either way there is genuinely NO PASSKEY here:
        //                 an orphan, repairable through a surviving passkey, and never fixed by retrying.
        //   otherwise  -> transport/RPC failure. The chain did not answer. That says NOTHING about the
        //                 wallet, and it IS retryable.
        //
        // Reading the zero-data throw as "the network failed" is the exact bug this file used to have:
        // it made every orphan look like a blip, forever.
        if (e instanceof BaseError && e.walk((err) => err instanceof ContractFunctionZeroDataError)) {
          return null;
        }
        throw new VaultUnreadableError(e);
      }
      // The read SUCCEEDED. An unknown slot returns an empty, inactive tuple (pinned by
      // contracts/test/Vault.t.sol), so this is a positively-established absence, not an error.
      // `version` and `addedAt` are unused here — the resolve path needs only the blob.
      const [blob, active] = raw as [Hex, boolean, bigint, bigint];
      if (!active || !blob || blob === "0x") return null;
      return hexToBytes(blob);
    },

    // Roster reads. An unreadable vault (account not yet delegated, RPC blip) yields an empty list /
    // zero — a settings screen degrades to "no access slots visible", never a thrown "wallet gone".
    async getAccessSlotIds(address: Address) {
      try {
        const ids = await client.readContract({
          address,
          abi: ACCESS_VAULT_ABI,
          functionName: "getAccessSlotIds",
          args: [],
        });
        return ids as readonly Hex[];
      } catch {
        return [];
      }
    },

    async getAccessSlotMeta(address: Address, slotId: Hex) {
      try {
        const raw = await client.readContract({
          address,
          abi: ACCESS_VAULT_ABI,
          functionName: "getAccessSlotMeta",
          args: [slotId],
        });
        const hex = raw as Hex;
        if (!hex || hex === "0x") return new Uint8Array(0);
        return hexToBytes(hex);
      } catch {
        return new Uint8Array(0);
      }
    },

    async getAccessSlotAddedAt(address: Address, slotId: Hex) {
      try {
        const raw = await client.readContract({
          address,
          abi: ACCESS_VAULT_ABI,
          functionName: "getAccessSlot",
          args: [slotId],
        });
        const [, , , addedAt] = raw as [Hex, boolean, bigint, bigint];
        return Number(addedAt);
      } catch {
        return 0;
      }
    },
  };
}
