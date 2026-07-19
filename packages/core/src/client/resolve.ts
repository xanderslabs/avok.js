import type { Address } from "viem";
import {
  type Call,
  type EvmChainProfile,
  type Disclosure,
  type ExecutionContext,
  type ResolvedBatch,
  type RpcClient,
  estimateNativeFee,
  isDelegatedTo,
  railFromContext,
  type NativeFeeEstimate,
} from "../evm/index.js";

export interface LeanResolveArgs {
  rpc: RpcClient;
  chain: EvmChainProfile;
  address: Address;
  userCalls: Call[];
  ctx: ExecutionContext; // { chainId, feeToken? }
  nonce: bigint;
  deadline: bigint;
}

/**
 * Assembles a ResolvedBatch from on-chain reads only.
 * Scoping rule: NO resolveBlob, NO passkey, NO access-slot call.
 * Covers: delegation authorization + userCalls (+ self-pay native-fee estimate).
 *
 * The 4337 SPONSORED rail commits NO fee call: the ERC-7677 paymaster sponsors the gas and charges the
 * user, so there is nothing to price or sign here. The bounded fee is derived at send/simulate time
 * from the bundler's gas estimate × maxFeePerGas + the paymaster's charge (see the SDK sponsored path).
 */
export async function leanResolve(args: LeanResolveArgs): Promise<ResolvedBatch> {
  let nativeFee: NativeFeeEstimate | undefined;
  const { rpc, chain, address, userCalls, ctx, nonce, deadline } = args;

  const rail = railFromContext(ctx);
  const feeCalls: Call[] = [];
  const disclosures: Disclosure[] = [];

  // 1. Delegation check (on-chain read only)
  const code = await rpc.getCode(address);
  let authorization: ResolvedBatch["authorization"];
  if (!isDelegatedTo(code, chain.canonicalImplementation)) {
    // Fail loudly: delegating to the zero address would corrupt the account.
    // This address is the PENDING placeholder — the contract must be deployed first.
    if (chain.canonicalImplementation === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        `canonicalImplementation for chain ${chain.chainId} is unset (zero address) — deploy the account contract and set it in the registry before sending`,
      );
    }
    // Fail loudly: the registry can name a canonicalImplementation before it's deployed on
    // every chain (deterministic address, staggered rollout). Delegating to an address with no
    // code would brick the account, so verify the delegate actually exists on this chain first.
    const implCode = await rpc.getCode(chain.canonicalImplementation);
    if (!implCode || implCode === "0x") {
      throw new Error(
        `canonicalImplementation ${chain.canonicalImplementation} is not deployed on chain ${chain.chainId} — deploy the delegate on this chain before sending`,
      );
    }
    const txNonce = await rpc.getTransactionCount(address);
    authorization = {
      chainId: chain.chainId,
      address: chain.canonicalImplementation,
      nonce: txNonce,
    };
    disclosures.push({ kind: "delegation", implementation: chain.canonicalImplementation });
  }

  // 2. Fee. SPONSORED (4337) commits no fee call — the paymaster charges the user, so there is nothing to
  //    price here. SELF-PAY signs no fee either, but the user still gets a native-cost ESTIMATE.
  if (rail === "self-pay") {
    nativeFee = await estimateNativeFee({
      rpc,
      walletAddress: address,
      implementation: chain.canonicalImplementation,
      calls: [...feeCalls, ...userCalls],
      undelegated: Boolean(authorization),
    });
  }

  return {
    rail,
    chainId: chain.chainId,
    walletAddress: address,
    feeCalls,
    userCalls,
    authorization,
    nonce,
    deadline,
    disclosures,
    // SPONSORED: remember the paymaster context token so a re-sent SimulationResult sponsors identically.
    ...(rail === "sponsored" ? { feeToken: ctx.feeToken ?? null } : {}),
    ...(nativeFee ? { nativeFee } : {}),
  };
}
