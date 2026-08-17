import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs script, no type declarations
import { applyWriteback } from "../script/write-canonical-address.mjs";
import { CHAIN_PROFILES } from "./registry.js";

const REAL_REGISTRY = join(__dirname, "registry.ts");
const FAKE = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
// Number of EVM canonicalImplementation slots — derived from the registry so adding an
// EVM chain profile automatically tracks here instead of needing a hand-bumped constant.
const EVM_SLOTS = Object.values(CHAIN_PROFILES).filter((p) => p.kind === "evm").length;

function tempRegistry(): string {
  const p = join(tmpdir(), `registry-writeback-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  // Normalize to PENDING regardless of the real registry's current state (it may already hold
  // the golden address on some/all chains after a real writeback) — these tests need a fixture
  // that starts PENDING so the "replaces PENDING with address" assertions stay self-contained.
  const content = readFileSync(REAL_REGISTRY, "utf8").replace(
    /canonicalImplementation: "0x[0-9a-fA-F]{40}"/g,
    "canonicalImplementation: PENDING",
  );
  writeFileSync(p, content);
  return p;
}

describe("write-canonical-address writeback", () => {
  const temps: string[] = [];
  const mk = () => {
    const p = tempRegistry();
    temps.push(p);
    return p;
  };
  afterEach(() => {
    for (const p of temps.splice(0)) rmSync(p, { force: true });
  });

  it("replaces every EVM canonicalImplementation: PENDING with the given address", () => {
    const p = mk();
    const before = readFileSync(p, "utf8");
    expect((before.match(/canonicalImplementation: PENDING/g) ?? []).length).toBe(EVM_SLOTS);

    const res = applyWriteback({ registryPath: p, address: FAKE });
    expect(res.replaced).toBe(EVM_SLOTS);
    expect(res.address).toBe(FAKE);

    const after = readFileSync(p, "utf8");
    expect(after).not.toMatch(/canonicalImplementation: PENDING/);
    expect((after.match(new RegExp(`canonicalImplementation: "${FAKE}"`, "g")) ?? []).length).toBe(EVM_SLOTS);
  });

  it("replaces canonicalImplementation: PENDING but leaves other 'address: PENDING' occurrences untouched", () => {
    const p = mk();
    // Seed a synthetic feed placeholder so this property is tested independently of the real
    // registry's feeds (Arc's are now real Pyth ids, so the registry no longer ships any
    // `address: PENDING` feed). The writeback must touch only canonicalImplementation.
    const seeded = readFileSync(p, "utf8").replace(
      "export const CHAIN_PROFILES",
      'const __TEST_FEED_PLACEHOLDER = { provider: "chainlink", address: PENDING };\nexport const CHAIN_PROFILES',
    );
    writeFileSync(p, seeded);
    const beforeFeeds = (readFileSync(p, "utf8").match(/address: PENDING/g) ?? []).length;
    expect(beforeFeeds).toBe(1);
    applyWriteback({ registryPath: p, address: FAKE });
    const afterFeeds = (readFileSync(p, "utf8").match(/address: PENDING/g) ?? []).length;
    expect(afterFeeds).toBe(beforeFeeds);
  });

  it("still contains valid TS structure after rewrite (parses, key markers intact)", () => {
    const p = mk();
    applyWriteback({ registryPath: p, address: FAKE });
    const after = readFileSync(p, "utf8");
    expect(after).toContain("export const CHAIN_PROFILES");
    expect(after).toContain("export function resolveAnchorChain");
    // balanced-ish braces sanity
    expect((after.match(/{/g) ?? []).length).toBe((after.match(/}/g) ?? []).length);
  });

  it("is idempotent: a second run with the same address is a no-op", () => {
    const p = mk();
    applyWriteback({ registryPath: p, address: FAKE });
    const res2 = applyWriteback({ registryPath: p, address: FAKE });
    expect(res2.noop).toBe(true);
    expect(res2.replaced).toBe(0);
  });

  it("refuses to overwrite an already-set address without --force", () => {
    const p = mk();
    applyWriteback({ registryPath: p, address: FAKE });
    expect(() => applyWriteback({ registryPath: p, address: OTHER })).toThrow(/--force/);
  });

  it("overwrites an already-set address with force: true", () => {
    const p = mk();
    applyWriteback({ registryPath: p, address: FAKE });
    const res = applyWriteback({ registryPath: p, address: OTHER, force: true });
    expect(res.replaced).toBe(EVM_SLOTS);
    const after = readFileSync(p, "utf8");
    expect((after.match(new RegExp(`canonicalImplementation: "${OTHER}"`, "g")) ?? []).length).toBe(EVM_SLOTS);
  });

  it("rejects the zero address, malformed input, and missing address", () => {
    const p = mk();
    expect(() => applyWriteback({ registryPath: p, address: "0x0000000000000000000000000000000000000000" })).toThrow();
    expect(() => applyWriteback({ registryPath: p, address: "0xdeadbeef" })).toThrow(/invalid/);
    expect(() => applyWriteback({ registryPath: p, address: undefined })).toThrow(/no address/);
  });

  it("fails loud when the registry file is missing", () => {
    expect(() => applyWriteback({ registryPath: "/no/such/registry.ts", address: FAKE })).toThrow(/not found/);
  });

  it("does NOT modify the real registry.ts", () => {
    // Snapshot the real file, run a writeback against a temp fixture derived from it, then
    // assert the real file is byte-identical — proves this operation never touches the real
    // registry, regardless of whether it currently holds PENDING or the golden address.
    const before = readFileSync(REAL_REGISTRY, "utf8");
    const p = mk();
    applyWriteback({ registryPath: p, address: FAKE });
    const after = readFileSync(REAL_REGISTRY, "utf8");
    expect(after).toBe(before);
  });
});
