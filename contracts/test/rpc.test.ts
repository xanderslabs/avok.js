import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evmRpcUrl, solanaRpcUrl, isPublicDefaultRpc } from "../src-ts/rpc.js";
import { getChainProfile, getSolanaChainProfile } from "../src-ts/registry.js";

const HELIUS = "https://mainnet.helius-rpc.com/?api-key=test";
const OWN_NODE = "https://base.internal.example.com";

describe("RPC resolution: override first, registry default second", () => {
  it("uses the caller's EVM override over the registry default", () => {
    expect(evmRpcUrl(8453, { evm: { 8453: OWN_NODE } })).toBe(OWN_NODE);
    expect(evmRpcUrl(8453)).toBe(getChainProfile(8453)!.rpcDefault);
  });

  it("uses the caller's Solana override over the registry default", () => {
    expect(solanaRpcUrl("mainnet", { solana: { mainnet: HELIUS } })).toBe(HELIUS);
    expect(solanaRpcUrl("mainnet")).toBe(getSolanaChainProfile("mainnet")!.rpcDefault);
  });

  it("overrides are per-chain — one configured chain does not affect the others", () => {
    const overrides = { evm: { 8453: OWN_NODE } };
    expect(evmRpcUrl(8453, overrides)).toBe(OWN_NODE);
    expect(evmRpcUrl(10, overrides)).toBe(getChainProfile(10)!.rpcDefault);
  });

  // An override is what makes an UNREGISTERED chain usable — otherwise adding a chain would mean
  // waiting on a registry release.
  it("an override alone is enough for a chain that is not in the registry", () => {
    const unknown = 999_999;
    expect(getChainProfile(unknown)).toBeUndefined();
    expect(evmRpcUrl(unknown, { evm: { [unknown]: OWN_NODE } })).toBe(OWN_NODE);
    expect(() => evmRpcUrl(unknown)).toThrow(/not in the registry/);
  });

  it("isPublicDefaultRpc reports whether a chain is still on the public dev endpoint", () => {
    expect(isPublicDefaultRpc({ solana: "mainnet" })).toBe(true);
    expect(isPublicDefaultRpc({ solana: "mainnet" }, { solana: { mainnet: HELIUS } })).toBe(false);
    expect(isPublicDefaultRpc({ evm: 8453 }, { evm: { 8453: OWN_NODE } })).toBe(false);
  });
});

/**
 * The seam only holds if nothing reaches around it. `rpcDefault` is the registry's PUBLIC endpoint;
 * a call site that reads it directly silently ignores the integrator's `rpcUrls` and pins that code
 * path to an endpoint that is rate-limited, SLA-less, and blocked for the indexed reads a wallet
 * needs. That is not a style rule — it is how the demo's Solana balances came to spin forever
 * against an endpoint nobody chose.
 *
 * Server-side packages (the relayers) are exempt: they are configured with their OWN rpcUrl and
 * already resolve `o.rpcUrl ?? chain.rpcDefault` themselves.
 */
describe("no client surface reads rpcDefault behind the resolver's back", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const GUARDED = ["sdk-core", "helpers", "wallet-core", "shared-origin", "react", "vanilla"];

  function sourceFiles(dir: string): string[] {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(sourceFiles(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it.each(GUARDED)("%s never reads profile.rpcDefault", (pkg) => {
    const src = join(ROOT, pkg, "src");
    let files: string[];
    try {
      files = sourceFiles(src);
    } catch {
      return; // package has no src/ — nothing to guard
    }
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf8");
      // Ignore prose: only flag actual property reads.
      return /\.rpcDefault\b/.test(text.replace(/^\s*\*.*$/gm, ""));
    });
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
