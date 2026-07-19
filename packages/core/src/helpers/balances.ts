import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { createSolanaRpc, address as solanaAddress } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { evmRpcUrl, getSolanaChainProfile, solanaRpcUrl, type RpcOverrides } from "@avokjs/contracts";
import { getChain, type SolanaCluster } from "./chains.js";
import { formatAmount } from "./amount.js";

/** The shape `getMultipleAccounts({encoding:"jsonParsed"})` returns for an SPL token account. */
type SplAccount = { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } };

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

const SOLANA_LAMPORTS_DECIMALS = 9;
/** A Solana read that has not answered in this long is treated as a dead RPC (→ 0), never a hang. */
const SOLANA_RPC_TIMEOUT_MS = 10_000;

/**
 * Read the native SOL balance + the cluster's configured SPL token balances for an address,
 * app-side — the SDK is headless on balances for BOTH chains (EVM is read via viem above), so the
 * app owns the Solana read via `@solana/kit`.
 *
 * SPL balances are read by DERIVING each token's associated token account and batching them into a
 * single `getMultipleAccounts`. It used to ask `getTokenAccountsByOwner` per mint, which is an
 * INDEXED OWNER-SCAN — the one question free Solana infrastructure will not answer. Public endpoints
 * hang on it forever (no response, no error), so token balances silently read 0 and the spinner ran
 * until the timeout fired.
 *
 * We never needed the scan: the mints come from the registry, so the ATA is a deterministic
 * derivation. Asking for the accounts directly is a plain read that every RPC tier serves — free
 * endpoints included — and it is ONE round-trip for all tokens instead of N.
 *
 * RPC URL: `rpcUrls` when given, else the registry's public default. A dead RPC, a missing token
 * account, or an unparseable one all resolve to 0 (same resilience as the EVM path).
 * Returns [native SOL, ...SPL].
 */
export async function readSolanaBalances(
  cluster: SolanaCluster,
  address: string,
  rpcUrls?: RpcOverrides,
): Promise<TokenBalance[]> {
  const profile = getSolanaChainProfile(cluster);
  const rpc = createSolanaRpc(solanaRpcUrl(cluster, rpcUrls));
  const owner = solanaAddress(address);

  // Every Solana read is time-boxed. Without this, "a dead RPC resolves to 0" is a lie: an endpoint
  // that hangs never rejects, so `.catch` never fires, `Promise.all` never settles, and the balances
  // spinner runs forever — an unresolvable promise the UI cannot render.
  const signal = () => AbortSignal.timeout(SOLANA_RPC_TIMEOUT_MS);

  const lamports = await rpc
    .getBalance(owner)
    .send({ abortSignal: signal() })
    .then((r) => r.value as bigint)
    .catch(() => 0n);
  const native: TokenBalance = {
    symbol: "SOL",
    address: null,
    decimals: SOLANA_LAMPORTS_DECIMALS,
    base: lamports,
    formatted: formatAmount(lamports, SOLANA_LAMPORTS_DECIMALS),
  };

  const splProfiles = profile ? Object.values(profile.tokens) : [];
  if (splProfiles.length === 0) return [native];

  // Derive the ATA for each registry token. Token-2022 mints seed a DIFFERENT PDA, so the token
  // program from the registry profile is load-bearing, not decoration.
  const atas = await Promise.all(
    splProfiles.map(async (t) => {
      const [pda] = await findAssociatedTokenPda({
        mint: solanaAddress(t.mint),
        owner,
        tokenProgram: solanaAddress(t.tokenProgram),
      });
      return pda;
    }),
  );

  // One batched read for every token.
  const accounts = await rpc
    .getMultipleAccounts(atas, { encoding: "jsonParsed" })
    .send({ abortSignal: signal() })
    .then((r) => r.value as unknown as (SplAccount | null)[])
    .catch(() => splProfiles.map(() => null));

  const spl = splProfiles.map((t, i): TokenBalance => {
    // A null account simply means the user has never held this token — 0, not an error.
    const amount = accounts[i]?.data?.parsed?.info?.tokenAmount?.amount;
    let base = 0n;
    try {
      if (amount) base = BigInt(amount);
    } catch {
      base = 0n; // a malformed amount must not blank the whole list
    }
    return { symbol: t.symbol, address: null, decimals: t.decimals, base, formatted: formatAmount(base, t.decimals) };
  });

  return [native, ...spl];
}
