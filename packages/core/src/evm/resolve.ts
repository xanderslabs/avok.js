import type { Address } from "viem";
import type { EvmChainProfile } from "@avokjs/contracts";
import { estimateNativeFee } from "./pricing.js";
import type { RpcClient } from "./rpc.js";
import {
  railFromContext,
  type Call,
  type Disclosure,
  type ExecutionContext,
  type ResolvedBatch,
  type NativeFeeEstimate,
} from "./types.js";

export interface ResolveArgs {
  rpc: RpcClient;
  chain: EvmChainProfile;
  address: Address;
  credentialId: string;
  userCalls: Call[];
  ctx: ExecutionContext;
  nonce: bigint;
  deadline: bigint;
}

const DESIGNATOR_PREFIX = "0xef0100";

/** EIP-7702 delegation designator is `0xef0100 ‖ implementation`. */
export function isDelegatedTo(code: `0x${string}`, implementation: Address): boolean {
  return code.toLowerCase() === (DESIGNATOR_PREFIX + implementation.slice(2)).toLowerCase();
}

/**
 * Assembles a ResolvedBatch from on-chain reads only. The SPONSORED (4337) rail commits no fee call —
 * the ERC-7677 paymaster sponsors the gas and charges the user, so nothing is priced here; the bounded
 * fee is derived at send/simulate time from the bundler estimate. SELF-PAY signs no fee either but
 * still surfaces a native-cost estimate. (Mirrors sdk-core's `leanResolve`.)
 */
export async function resolveBatch(args: ResolveArgs): Promise<ResolvedBatch> {
  const rail = railFromContext(args.ctx);
  const feeCalls: Call[] = [];
  const disclosures: Disclosure[] = [];
  // Self-pay's cost ESTIMATE, not a signed amount (see NativeFeeEstimate).
  let nativeFee: NativeFeeEstimate | undefined;

  // 1. Delegation check
  const code = await args.rpc.getCode(args.address);
  let authorization: ResolvedBatch["authorization"];
  if (!isDelegatedTo(code, args.chain.canonicalImplementation)) {
    // Fail loudly: delegating to the zero address would corrupt the account.
    if (args.chain.canonicalImplementation === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        `canonicalImplementation for chain ${args.chain.chainId} is unset (zero address) — deploy the account contract and set it in the registry before sending`,
      );
    }
    // Fail loudly: the registry may name the canonical address on a chain where it is
    // not yet deployed. Delegating to a codeless address would brick the account.
    const implCode = await args.rpc.getCode(args.chain.canonicalImplementation);
    if (!implCode || implCode === "0x") {
      throw new Error(
        `canonicalImplementation ${args.chain.canonicalImplementation} is not deployed on chain ${args.chain.chainId} — deploy the delegate on this chain before sending`,
      );
    }
    const nonce = await args.rpc.getTransactionCount(args.address);
    authorization = { chainId: args.chain.chainId, address: args.chain.canonicalImplementation, nonce };
    disclosures.push({ kind: "delegation", implementation: args.chain.canonicalImplementation });
  }

  // 2. Fee. SPONSORED commits none (the paymaster charges it). SELF-PAY signs none but gets an estimate.
  if (rail === "self-pay") {
    nativeFee = await estimateNativeFee({
      rpc: args.rpc,
      walletAddress: args.address,
      implementation: args.chain.canonicalImplementation,
      calls: [...feeCalls, ...args.userCalls],
      undelegated: Boolean(authorization),
    });
  }

  return {
    rail,
    chainId: args.chain.chainId,
    walletAddress: args.address,
    feeCalls,
    userCalls: args.userCalls,
    authorization,
    nonce: args.nonce,
    deadline: args.deadline,
    disclosures,
    ...(rail === "sponsored" ? { feeToken: args.ctx.feeToken ?? null } : {}),
    ...(nativeFee ? { nativeFee } : {}),
  };
}
