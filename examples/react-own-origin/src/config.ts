import type { Address } from "viem";
import { resolveChainByName, chainIdNumberByName } from "@avokjs/contracts";
import type { RpcOverrides } from "@avokjs/contracts";

const env = import.meta.env;

export type SolanaCluster = "devnet" | "mainnet";

// The chain where THIS wallet anchors its secondary-device access slots. Referenced by NAME
// (VITE_ANCHOR_CHAIN, default "optimism" = the SDK's DEFAULT_ANCHOR_CHAIN_ID eip155:10) and resolved
// to CAIP-2 (for createOwnOriginConnection) + numeric (for the UI's home-base default + hasAccessSlot).
const anchorChainName = (env.VITE_ANCHOR_CHAIN as string | undefined) ?? "optimism";

// A single PRF evaluation IS the wallet key, and PRF is scoped to (credential, rpId) — NOT to the
// page's code. Every origin that matches this RP-ID can derive a user's private keys. Pin it
// explicitly; never infer it from the URL bar, and never widen it to an apex you don't fully
// control. See docs/superpowers/specs/2026-07-09-avok-prf-derived-wallet-design.md § Security.
const rpId = env.VITE_RP_ID as string | undefined;
if (!rpId) {
  throw new Error(
    "VITE_RP_ID must be set explicitly: every origin matching this RP-ID can derive wallet private keys.",
  );
}

// FAIL LOUD IF THE RP-ID DOES NOT MATCH THE PAGE WE ARE ACTUALLY ON.
//
// WebAuthn requires the rpId to be the origin's effective domain, or a registrable-domain suffix of
// it. If it is not, EVERY passkey call dies with an opaque browser error — "The requested RPID did
// not match the origin or related origins", or a bare NotAllowedError — which says nothing about the
// cause and sends you hunting through the wrong things.
//
// This bites hardest on a LAN test bed: `vite --host 0.0.0.0` answers to ANY Host header, so if two
// demos share a port (or one is not running), a different hostname silently serves you the WRONG
// APP — one built with a different rpId — and the browser blames the passkey. Say what is actually
// wrong, before a single credential call is made.
if (typeof window !== "undefined") {
  const host = window.location.hostname;
  const ok = host === rpId || host.endsWith(`.${rpId}`);
  if (!ok) {
    throw new Error(
      `RP-ID mismatch: this app was built with VITE_RP_ID="${rpId}", but it is being served from ` +
        `"${host}". WebAuthn will refuse every call. Either open it on https://${rpId} (check you ` +
        `started THIS demo's dev server on THIS port — another demo may be answering here), or set ` +
        `VITE_RP_ID to a registrable-domain suffix of "${host}".`,
    );
  }
}

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
  rpId,
  // Friendly operator name shown in the passkey prompt + wallet label; falls back to the rpId domain.
  operatorName: env.VITE_OPERATOR_NAME as string | undefined,
  // CAIP-2 (eip155:10) for createOwnOriginConnection; numeric (10) for UI defaults + read.hasAccessSlot.
  anchorChainId: resolveChainByName(anchorChainName),
  anchorChainNumeric: chainIdNumberByName(anchorChainName),
  paymasterUrl: env.VITE_PAYMASTER_URL as string | undefined,
  bundlerUrl: env.VITE_BUNDLER_URL as string | undefined,
  koraUrl: env.VITE_KORA_URL as string | undefined,
  subname: {
    registrar: env.VITE_SUBNAME_REGISTRAR as Address | undefined,
    parent: env.VITE_SUBNAME_PARENT as string | undefined,
  },
  sns: {
    registrar: env.VITE_SNS_REGISTRAR as string | undefined,
    parent: env.VITE_SNS_PARENT as string | undefined,
  },
} as const;

// Fronted readiness is the paymaster/bundler/Kora URL only — the fee TOKEN is chain-specific and is read
// per-chain from the registry (client.evm.feeTokens / client.solana.feeTokens) at send time, never
// from a global env var. The Send screen ANDs these with "target chain has ≥1 supported fee token".
/** True when BOTH the EVM 7677 paymaster AND the 4337 bundler are configured (fronted needs both). */
export const hasEvmFronted = Boolean(config.paymasterUrl && config.bundlerUrl);
/** True when a Kora URL is configured. Kora is BOTH the fee payer and the submitter, so unlike EVM
 *  (which needs a paymaster AND a bundler) Solana fronting needs this one endpoint. */
export const hasSolanaFronted = Boolean(config.koraUrl);
/** True when the ENS subname registrar/parent are configured. */
export const hasEnsSubname = Boolean(config.subname.registrar && config.subname.parent);
/** True when the SNS (.sol) sub-registrar/parent are configured. */
export const hasSnsSubname = Boolean(config.sns.registrar && config.sns.parent);
