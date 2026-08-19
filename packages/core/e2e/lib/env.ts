// Loads the funded Base Sepolia deployer key from contracts/.env into a process-local variable ONLY.
// NEVER logged, NEVER written to any file, NEVER returned as part of an object a caller might
// stringify/JSON.parse into a log. Every consumer takes the raw key and converts it straight into a
// viem account, which is the only thing that leaves this module.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/e2e/lib -> repo root/contracts/.env
const CONTRACTS_ENV = resolve(here, "../../../../contracts/.env");

function readDeployerKey(): `0x${string}` | undefined {
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY as `0x${string}`;
  if (!existsSync(CONTRACTS_ENV)) return undefined;
  const src = readFileSync(CONTRACTS_ENV, "utf8");
  const m = src.match(/^DEPLOYER_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  return m ? (m[1] as `0x${string}`) : undefined;
}

export const BASE_SEPOLIA_CHAIN_ID = 84532;

// The registry's own default (contracts/src-ts/registry.ts, verified live 2026-08-19: chainId,
// Multicall3, eth_simulateV1 all healthy at deploy time). NOT used directly by these E2E scripts —
// see BASE_SEPOLIA_RPC below. Kept as a named constant so the operational finding below is legible
// against what the registry actually documents.
export const BASE_SEPOLIA_REGISTRY_RPC = "https://sepolia.base.org";

// OPERATIONAL FINDING (2026-08-19, during this E2E run): the registry default above returned a
// sustained HTTP 503 "no backend is currently healthy to serve traffic" specifically on
// `eth_gasPrice` / `eth_maxPriorityFeePerGas` (confirmed via `cast rpc`, repeated over ~30s) while
// `eth_chainId`/`eth_call` on the SAME endpoint worked fine — a partial outage, not a dead chain. The
// SDK's native-gas rail calls `getMaxPriorityFeePerGas()` on every send, so this is a real, current
// blocker for anyone using the registry default right now, not a fake induced by this test. Routing
// E2E traffic through a second public endpoint (publicnode) confirmed the chain itself is healthy.
// This does NOT change the registry's rpcDefault — that stays Base's own official endpoint per
// CHAIN_VERIFICATION.md convention; an operator hitting this outage overrides `rpcUrls` per
// `ClientConfig`'s own documented mechanism, exactly as done here.
export const BASE_SEPOLIA_RPC = process.env.E2E_BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com";

/** True only when a funded deployer key is actually available — the gate every live E2E script uses
 *  to skip cleanly instead of throwing when nobody wired up funds. */
export function hasLiveFunding(): boolean {
  return readDeployerKey() !== undefined;
}

/** The funded Base Sepolia deployer account. Throws (not undefined) — callers that reach here already
 *  checked `hasLiveFunding()`. */
export function deployerAccount(): PrivateKeyAccount {
  const key = readDeployerKey();
  if (!key) throw new Error("e2e/lib/env: no DEPLOYER_KEY (env or contracts/.env) — live tests cannot run");
  return privateKeyToAccount(key);
}
