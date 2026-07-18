import type { RpcOverrides } from "@avokjs/contracts";

const env = import.meta.env;

export type SolanaCluster = "devnet" | "mainnet";

// RPC endpoints. Avok ships NO third-party provider as a default, because an RPC is a trust
// boundary: it answers "what address does vitalik.eth / toly.sol resolve to?", and an endpoint that
// lies there sends your money to the liar. Unset chains fall back to the registry's PUBLIC endpoint,
// which is DEVELOPMENT-ONLY — public endpoints are rate-limited, have no SLA, and refuse the indexed
// reads a wallet needs (they 403 or hang on getTokenAccountsByOwner, so SPL balances read 0).
//
// Set your own and this all works with NO backend: a domain-allowlisted provider key is safe in a
// browser bundle (it is useless from any other origin). Or point these at a proxy you host — the
// Avok operator can be one — and the key never leaves your server.
function readRpcUrls(): RpcOverrides | undefined {
  const solanaMainnet = env.VITE_SOLANA_RPC_MAINNET as string | undefined;
  const solanaDevnet = env.VITE_SOLANA_RPC_DEVNET as string | undefined;
  // Advanced: a JSON map of chainId -> url, e.g. {"8453":"https://base.example.com"}
  const evmRaw = env.VITE_EVM_RPC_URLS as string | undefined;

  const solana = {
    ...(solanaMainnet ? { mainnet: solanaMainnet } : {}),
    ...(solanaDevnet ? { devnet: solanaDevnet } : {}),
  };
  let evm: Record<number, string> | undefined;
  if (evmRaw) {
    try {
      evm = Object.fromEntries(
        Object.entries(JSON.parse(evmRaw) as Record<string, string>).map(([id, url]) => [Number(id), url]),
      );
    } catch {
      // Fail loud: a typo here silently drops you onto a public endpoint you did not choose.
      throw new Error("VITE_EVM_RPC_URLS must be JSON, e.g. {\"8453\":\"https://...\"}");
    }
  }

  const out: RpcOverrides = {
    ...(Object.keys(solana).length ? { solana } : {}),
    ...(evm && Object.keys(evm).length ? { evm } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

export const config = {
  rpcUrls: readRpcUrls(),
  // ── Shared-origin (use-only) ──────────────────────────────────────────
  // The wallet's keys live at the operator's auth origin; this app only
  // obtains signatures over the shared-origin popup channel.
  authOrigin: (env.VITE_AUTH_ORIGIN as string | undefined) ?? window.location.origin,
  // Operator's own-origin wallet app (create/manage/back up happen there, not here).
  managementUrl: env.VITE_MANAGEMENT_URL as string | undefined,
  // Comma-separated in the env var; parsed to the string[] the connection wants.

  // ── Shared (same shape as react-own-origin) ───────────────────────────
  // Shared-origin apps don't manage custody, so there is no anchor chain — the UI just picks a
  // display-default EVM chain (first SELECTABLE_CHAIN) and a Solana cluster per screen.
  paymasterUrl: env.VITE_PAYMASTER_URL as string | undefined,
  bundlerUrl: env.VITE_BUNDLER_URL as string | undefined,
  koraUrl: env.VITE_KORA_URL as string | undefined,
} as const;

// Sponsored readiness is the paymaster/bundler/Kora URL only — the fee TOKEN is chain-specific and is read
// per-chain from the registry (client.evm.feeTokens / client.solana.feeTokens) at send time, never
// from a global env var. The Send screen ANDs these with "target chain has ≥1 supported fee token".
/** True when an EVM paymaster URL is configured. */
export const hasEvmSponsored = Boolean(config.paymasterUrl && config.bundlerUrl);
/** True when a Kora URL is configured. Kora is BOTH the fee payer and the submitter, so unlike EVM
 *  (which needs a paymaster AND a bundler) Solana sponsoring needs this one endpoint. */
export const hasSolanaSponsored = Boolean(config.koraUrl);
