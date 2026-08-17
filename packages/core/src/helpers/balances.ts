import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { evmRpcUrl, type RpcOverrides } from "@avokjs/contracts";
import { getChain } from "./chains.js";
import { formatAmount } from "./amount.js";

/** The shape `getMultipleAccounts({encoding:"jsonParsed"})` returns for an SPL token account. */

export type TokenBalance = {
  symbol: string;
  /** null for the native gas asset. */
  address: Address | null;
  decimals: number;
  base: bigint;
  formatted: string;
};

function publicClientFor(chainId: number, rpcUrls?: RpcOverrides) {
  return createPublicClient({ transport: http(evmRpcUrl(chainId, rpcUrls)) });
}

/**
 * Read the native + configured ERC-20 balances for an address on an EVM chain. The SDK is
 * headless (it does not read balances), so the app owns this via viem. Returns [native, ...tokens];
 * failed reads resolve to a 0 balance so one dead RPC never blanks the whole list.
 *
 * `rpcUrls` — your own endpoints. Without them this uses the registry's PUBLIC default, which is
 * fine for development and unfit for production (see contracts/rpc.ts).
 */
export async function readBalances(chainId: number, address: Address, rpcUrls?: RpcOverrides): Promise<TokenBalance[]> {
  const chain = getChain(chainId);
  if (!chain) return [];
  const client = publicClientFor(chainId, rpcUrls);

  const nativeBase = await client.getBalance({ address }).catch(() => 0n);
  const native: TokenBalance = {
    symbol: chain.nativeSymbol,
    address: null,
    decimals: 18,
    base: nativeBase,
    formatted: formatAmount(nativeBase, 18),
  };

  const tokens = await Promise.all(
    chain.tokens.map(async (t): Promise<TokenBalance> => {
      const base = await client
        .readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address] })
        .catch(() => 0n);
      return {
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
        base: base as bigint,
        formatted: formatAmount(base as bigint, t.decimals),
      };
    }),
  );

  return [native, ...tokens];
}
