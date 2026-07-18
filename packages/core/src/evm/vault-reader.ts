import { BaseError, ContractFunctionZeroDataError, type Address, type Hex, hexToBytes } from "viem";
import { ACCESS_VAULT_ABI, VaultUnreadableError, type VaultReader } from "../wallet/index.js";
import type { RpcClient } from "./rpc.js";

/** Live VaultReader over the on-chain access vault (`getAccessSlot`/`accessSlotCount`). */
export function createViemVaultReader(rpc: RpcClient): VaultReader {
  return {
    async getAccessSlot(address: Address, slotId: Hex) {
      // This reader and wallet-core's registry reader MUST classify identically. Two readers that
      // disagree about what "no access slot" means is worse than one reader that is wrong. (RpcClient's
      // readContract is a bare pass-through of viem's, so the cause chain survives the wrapper —
      // checked, not assumed; if that ever changes, the walk() below silently stops matching and every
      // orphan gets misfiled as a network blip.)
      let raw: readonly [Hex, boolean, bigint, bigint];
      try {
        raw = await rpc.readContract<readonly [Hex, boolean, bigint, bigint]>({
          address, abi: ACCESS_VAULT_ABI, functionName: "getAccessSlot", args: [slotId],
        });
      } catch (e) {
        // ZERO DATA -> nothing to decode: the account is not delegated yet (every fresh wallet, until
        // its first tx) or carries no vault. There is genuinely NO ACCESS SLOT: an ORPHAN, not retryable.
        // Anything else -> the chain did not answer. Retryable, and evidence of nothing.
        if (e instanceof BaseError && e.walk((err) => err instanceof ContractFunctionZeroDataError)) {
          return null;
        }
        throw new VaultUnreadableError(e);
      }
      // `version` (the monotonic rollback counter) is returned but unused here.
      const [blob, active] = raw;
      if (!active || blob === "0x") return null;
      return hexToBytes(blob);
    },
    async accessSlotCount(address: Address) {
      return rpc.readContract<bigint>({
        address, abi: ACCESS_VAULT_ABI, functionName: "accessSlotCount",
      });
    },
  };
}
