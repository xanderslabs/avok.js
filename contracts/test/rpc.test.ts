import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evmRpcUrl, evmRpcUrls, isPublicDefaultRpc } from "../src-ts/rpc.js";
import { getChainProfile, listChains } from "../src-ts/registry.js";

const OWN_NODE = "https://base.internal.example.com";

describe("RPC resolution: override first, registry default second", () => {
  it("uses the caller's EVM override over the registry default", () => {
    expect(evmRpcUrl(8453, { evm: { 8453: OWN_NODE } })).toBe(OWN_NODE);
    expect(evmRpcUrl(8453)).toBe(getChainProfile(8453)!.defaultRpc[0]);
  });


  it("overrides are per-chain — one configured chain does not affect the others", () => {
    const overrides = { evm: { 8453: OWN_NODE } };
    expect(evmRpcUrl(8453, overrides)).toBe(OWN_NODE);
    expect(evmRpcUrl(10, overrides)).toBe(getChainProfile(10)!.defaultRpc[0]);
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
    expect(isPublicDefaultRpc({ evm: 8453 })).toBe(true);
    expect(isPublicDefaultRpc({ evm: 8453 }, { evm: { 8453: OWN_NODE } })).toBe(false);
  });
});

describe("evmRpcUrls: the full failover list (TDD §8, amended 2026-08-19)", () => {
  it("returns the registry's whole defaultRpc list when no override is given", () => {
    expect(evmRpcUrls(8453)).toEqual(getChainProfile(8453)!.defaultRpc);
    expect(evmRpcUrls(8453).length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes a single-string override to a one-element list", () => {
    expect(evmRpcUrls(8453, { evm: { 8453: OWN_NODE } })).toEqual([OWN_NODE]);
  });

  it("passes through an array override verbatim, in order", () => {
    const SECOND_NODE = "https://base.internal2.example.com";
    expect(evmRpcUrls(8453, { evm: { 8453: [OWN_NODE, SECOND_NODE] } })).toEqual([OWN_NODE, SECOND_NODE]);
  });

  it("every registry chain's defaultRpc carries at least 2 independent providers, except the one documented as pending a second (Robinhood Chain, chainId 4663)", () => {
    for (const chain of listChains()) {
      if (chain.kind !== "evm") continue;
      if (chain.chainId === 4663) continue; // Robinhood: pending its own dedicated probe — see registry.ts
      expect(chain.defaultRpc.length, `chainId ${chain.chainId} (${chain.name})`).toBeGreaterThanOrEqual(2);
    }
  });
});

/**
 * The seam only holds if nothing reaches around it. `defaultRpc` is the registry's PUBLIC endpoint
 * list; a call site that reads it directly silently ignores the integrator's `rpcUrls` AND the
 * failover requirement (TDD §8), pinning that code path to a single endpoint that is rate-limited,
 * SLA-less, and blocked for the indexed reads a wallet needs. That is not a style rule — it is how a
 * demo's balances came to spin forever against an endpoint nobody chose.
 */
describe("no client surface reads defaultRpc behind the resolver's back", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const GUARDED = ["packages/core", "packages/react", "packages/react-native"];

  function sourceFiles(dir: string): string[] {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(sourceFiles(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it.each(GUARDED)("%s never reads profile.defaultRpc", (pkg) => {
    const src = join(ROOT, pkg, "src");
    // No swallowing a missing src/: a package that moves or is renamed must break this guard
    // loudly. Returning early instead would let every case pass having read nothing.
    const files = sourceFiles(src);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf8");
      // Ignore prose: only flag actual property reads.
      return /\.defaultRpc\b/.test(text.replace(/^\s*\*.*$/gm, ""));
    });
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
