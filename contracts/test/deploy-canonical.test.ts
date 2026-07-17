import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAIN_IDS,
  GOLDEN,
  resolveChainId,
  parseArgs,
  resolveKeySource,
  composeForgeArgs,
  assertGolden,
  runDeploy,
} from "../script/deploy-canonical.mjs";
import { CHAIN_PROFILES } from "../src-ts/registry.js";

const REAL_REGISTRY = join(__dirname, "../src-ts/registry.ts");
const NON_GOLDEN = "0x1111111111111111111111111111111111111111";
// Number of EVM chain profiles the writeback touches — derived from the registry so
// adding an EVM chain can never desync this from the number of canonicalImplementation slots.
const EVM_SLOTS = Object.values(CHAIN_PROFILES).filter((p) => p.kind === "evm").length;

function tempRegistry(): string {
  const p = join(tmpdir(), `deploy-canonical-registry-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
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

describe("deploy-canonical chain map + arg parsing (pure)", () => {
  it("resolves known chain names to chainIds", () => {
    expect(resolveChainId("ethereum")).toBe(1);
    expect(resolveChainId("optimism")).toBe(10);
    expect(resolveChainId("bsc")).toBe(56);
    expect(resolveChainId("base")).toBe(8453);
    expect(resolveChainId("arbitrum")).toBe(42161);
    expect(resolveChainId("arc")).toBe(5042002);
  });

  it("throws on an unknown chain name and lists valid names", () => {
    expect(() => resolveChainId("nope")).toThrow(/ethereum/);
    expect(() => resolveChainId("nope")).toThrow(/arbitrum/);
  });

  it("throws when --rpc is missing", () => {
    expect(() => parseArgs(["--chain", "base"])).toThrow(/--rpc/);
  });

  it("throws when --chain is missing", () => {
    expect(() => parseArgs(["--rpc", "https://rpc.example"])).toThrow(/--chain/);
  });

  it("parses a full valid arg set", () => {
    const args = parseArgs(["--chain", "base", "--rpc", "https://rpc.example", "--account", "deployer", "--dry-run", "--force"]);
    expect(args).toMatchObject({
      chain: "base",
      rpc: "https://rpc.example",
      account: "deployer",
      dryRun: true,
      force: true,
    });
  });
});

describe("deploy-canonical key-source resolution (pure)", () => {
  it("prefers --account when given", () => {
    const src = resolveKeySource({ account: "deployer", env: { DEPLOYER_PRIVATE_KEY: "0xabc" } });
    expect(src).toEqual({ kind: "account", account: "deployer" });
  });

  it("falls back to DEPLOYER_PRIVATE_KEY when no --account", () => {
    const src = resolveKeySource({ account: undefined, env: { DEPLOYER_PRIVATE_KEY: "0xabc" } });
    expect(src).toEqual({ kind: "privateKey", privateKey: "0xabc" });
  });

  it("throws with guidance when neither is provided", () => {
    expect(() => resolveKeySource({ account: undefined, env: {} })).toThrow(/--account/);
    expect(() => resolveKeySource({ account: undefined, env: {} })).toThrow(/DEPLOYER_PRIVATE_KEY/);
  });

  it("rejects a key-shaped --account value (a pasted private key, with or without 0x)", () => {
    const key = "1".repeat(64);
    expect(() => resolveKeySource({ account: key, env: {} })).toThrow(/keystore NAME, not a private key/);
    expect(() => resolveKeySource({ account: `0x${key}`, env: {} })).toThrow(/keystore NAME, not a private key/);
  });
});

// Regression guard: the CLI's own tests stub the artifact reader, so they never
// exercise the real `import { addressFromBroadcast } from "./write-canonical-address.mjs"`.
// A missing export there throws only at real module-load time (as it did on first run).
// Import the real modules here so a dropped export fails a test, not a deploy.
describe("deploy-canonical real module wiring", () => {
  it("loads the CLI module and resolves every named import at runtime", async () => {
    const cli = await import("../script/deploy-canonical.mjs");
    expect(typeof cli.runDeploy).toBe("function");
    expect(typeof cli.assertGolden).toBe("function");
  });

  it("write-canonical-address exports the helpers the CLI imports", async () => {
    const wb = await import("../script/write-canonical-address.mjs");
    expect(typeof wb.applyWriteback).toBe("function");
    expect(typeof wb.addressFromBroadcast).toBe("function");
  });
});

describe("deploy-canonical forge arg composition (pure)", () => {
  it("uses --account and omits --broadcast for a dry run", () => {
    const args = composeForgeArgs({
      rpc: "https://rpc.example",
      keySource: { kind: "account", account: "deployer" },
      broadcast: false,
    });
    expect(args).toEqual(["script", "script/DeployCanonical.s.sol", "--rpc-url", "https://rpc.example", "--account", "deployer"]);
  });

  it("uses --private-key and includes --broadcast for a real run", () => {
    const args = composeForgeArgs({
      rpc: "https://rpc.example",
      keySource: { kind: "privateKey", privateKey: "0xsecret" },
      broadcast: true,
    });
    expect(args).toEqual([
      "script",
      "script/DeployCanonical.s.sol",
      "--rpc-url",
      "https://rpc.example",
      "--private-key",
      "0xsecret",
      "--broadcast",
    ]);
  });
});

describe("deploy-canonical golden assertion (pure)", () => {
  it("accepts the golden address in any case", () => {
    expect(assertGolden(GOLDEN)).toBe(GOLDEN);
    expect(assertGolden(GOLDEN.toLowerCase())).toBe(GOLDEN);
    expect(assertGolden(GOLDEN.toUpperCase().replace("0X", "0x"))).toBe(GOLDEN);
  });

  it("throws on a non-golden address", () => {
    expect(() => assertGolden(NON_GOLDEN)).toThrow(/golden/);
  });
});

describe("deploy-canonical end-to-end (stubbed forge, temp registry)", () => {
  const temps: string[] = [];
  const mk = () => {
    const p = tempRegistry();
    temps.push(p);
    return p;
  };
  afterEach(() => {
    for (const p of temps.splice(0)) rmSync(p, { force: true });
  });

  it("dry run: invokes forge without --broadcast, writes nothing, reads no artifact", () => {
    const registryPath = mk();
    const forgeCalls: unknown[] = [];
    const result = runDeploy({
      argv: ["--chain", "base", "--rpc", "https://rpc.example", "--account", "deployer", "--dry-run"],
      runForge: (args: string[]) => forgeCalls.push(args),
      readArtifact: () => {
        throw new Error("should not read artifact during a dry run");
      },
      registryPath,
    });
    expect(result.dryRun).toBe(true);
    expect(forgeCalls).toHaveLength(1);
    expect(forgeCalls[0]).not.toContain("--broadcast");
    const after = readFileSync(registryPath, "utf8");
    expect((after.match(/canonicalImplementation: PENDING/g) ?? []).length).toBe(EVM_SLOTS);
  });

  it("real run with a GOLDEN stubbed artifact: broadcasts, writes GOLDEN to the temp registry only", () => {
    // Snapshot the real registry before running against the temp fixture, then assert it's
    // byte-identical after — proves this test only ever mutates the temp file, regardless of
    // whether the real registry currently holds PENDING or the golden address.
    const realBefore = readFileSync(REAL_REGISTRY, "utf8");
    const registryPath = mk();
    const result = runDeploy({
      argv: ["--chain", "base", "--rpc", "https://rpc.example", "--account", "deployer"],
      runForge: () => {},
      readArtifact: () => GOLDEN,
      registryPath,
    });
    expect(result.replaced).toBe(EVM_SLOTS);
    expect(result.address).toBe(GOLDEN);
    const after = readFileSync(registryPath, "utf8");
    expect((after.match(new RegExp(`canonicalImplementation: "${GOLDEN}"`, "g")) ?? []).length).toBe(EVM_SLOTS);

    const realAfter = readFileSync(REAL_REGISTRY, "utf8");
    expect(realAfter).toBe(realBefore);
  });

  it("real run with a NON-golden stubbed artifact: throws and writes nothing", () => {
    const registryPath = mk();
    expect(() =>
      runDeploy({
        argv: ["--chain", "base", "--rpc", "https://rpc.example", "--account", "deployer"],
        runForge: () => {},
        readArtifact: () => NON_GOLDEN,
        registryPath,
      }),
    ).toThrow(/golden/);
    const after = readFileSync(registryPath, "utf8");
    expect((after.match(/canonicalImplementation: PENDING/g) ?? []).length).toBe(EVM_SLOTS);
  });

  it("throws before invoking forge when no key source is available", () => {
    const registryPath = mk();
    const forgeCalls: unknown[] = [];
    expect(() =>
      runDeploy({
        argv: ["--chain", "base", "--rpc", "https://rpc.example"],
        runForge: (args: string[]) => forgeCalls.push(args),
        env: {},
        registryPath,
      }),
    ).toThrow(/--account/);
    expect(forgeCalls).toHaveLength(0);
  });
});
