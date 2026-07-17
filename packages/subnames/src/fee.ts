import { encodeFunctionData, type Address } from "viem";
import { AvokSubnameRegistrarABI } from "@avokjs/contracts";
import type { Call } from "./registrar.js";

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface FeeReaderClient {
  readContract(args: {
    address: Address;
    abi: typeof AvokSubnameRegistrarABI;
    functionName: "mintFee";
    args: readonly [];
  }): Promise<readonly [Address, bigint, Address]>;
}

/** Read the registrar's current mint-fee config (single source of truth for display + approve amount). */
export async function readMintFee(opts: {
  client: FeeReaderClient;
  registrar: Address;
}): Promise<{ token: Address; price: bigint; treasury: Address }> {
  const [token, price, treasury] = await opts.client.readContract({
    address: opts.registrar,
    abi: AvokSubnameRegistrarABI,
    functionName: "mintFee",
    args: [],
  });
  return { token, price, treasury };
}

/** ERC-20 approve(registrar, price) — prepended to the mint batch so the registrar can pull the fee. */
export function buildApproveFeeCall(feeToken: Address, registrar: Address, price: bigint): Call {
  return {
    to: feeToken,
    value: 0n,
    data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [registrar, price] }),
  };
}
