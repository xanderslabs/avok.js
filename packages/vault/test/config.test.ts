import { describe, it, expect } from "vitest";
import {
  parseVaultConfig,
  bakedAppConfig,
  resolveVaultRpcs,
  resolveVaultRpcsByChainId,
  VaultConfigError,
} from "../src/config.js";

const valid = { rpId: "vault.example1.com", vaultOrigin: "https://vault.example1.com", chains: ["base"] };

describe("parseVaultConfig", () => {
  it("accepts an rpId equal to the Vault origin host", () => {
    expect(parseVaultConfig(valid).rpId).toBe("vault.example1.com");
  });

  it("accepts an rpId that is a registrable suffix of the Vault host, for operators migrating", () => {
    const cfg = parseVaultConfig({ ...valid, rpId: "example1.com" });
    expect(cfg.rpId).toBe("example1.com");
  });

  it("rejects an rpId that is not a suffix of the Vault host", () => {
    expect(() => parseVaultConfig({ ...valid, rpId: "attacker.com" })).toThrow(VaultConfigError);
  });

  // A SUFFIX IS NOT A SUBSTRING. "notexample1.com" ends with "example1.com" as text, but it is a
  // different registrable domain, and accepting it would let any lookalike host pin someone else's
  // rpId. The dot is what makes it a label boundary.
  it("rejects a host that merely ends with the rpId text, without a label boundary", () => {
    expect(() => parseVaultConfig({ rpId: "example1.com", vaultOrigin: "https://notexample1.com" })).toThrow(
      VaultConfigError,
    );
  });

  it("rejects a missing rpId, because an inferred one derives a different wallet", () => {
    expect(() => parseVaultConfig({ vaultOrigin: valid.vaultOrigin })).toThrow(/rpId is required/);
  });

  it("rejects the placeholder rpId", () => {
    expect(() => parseVaultConfig({ ...valid, rpId: "wallet.example.com" })).toThrow(/placeholder/);
  });

  it("rejects a non-HTTPS Vault origin", () => {
    expect(() => parseVaultConfig({ rpId: "a.example.com", vaultOrigin: "http://a.example.com" })).toThrow(/https/);
  });

  it("allows http on localhost for development", () => {
    const cfg = parseVaultConfig({ rpId: "localhost", vaultOrigin: "http://localhost:5173", chains: ["base"] });
    expect(cfg.vaultOrigin).toBe("http://localhost:5173");
  });

  it("rejects a missing chains array", () => {
    expect(() => parseVaultConfig({ rpId: valid.rpId, vaultOrigin: valid.vaultOrigin })).toThrow(/chains is required/);
  });

  it("rejects an empty chains array", () => {
    expect(() => parseVaultConfig({ ...valid, chains: [] })).toThrow(/chains is required/);
  });

  it("rejects an unknown chain name, naming the valid ones", () => {
    expect(() => parseVaultConfig({ ...valid, chains: ["not-a-real-chain"] })).toThrow(/unknown chain name/i);
  });

  it("accepts an rpcOverrides map and carries it through", () => {
    const cfg = parseVaultConfig({ ...valid, rpcOverrides: { base: "https://my-own-base-rpc.example.com" } });
    expect(cfg.rpcOverrides).toEqual({ base: "https://my-own-base-rpc.example.com" });
  });

  // The Vault popup only reads `operatorName` and `rpId`: it authorizes and it signs, and it never
  // enrols. An anchor chain here would be a config value nothing consumes. Enrolment's own
  // `anchorChainId` lives on `ClientConfig` and is untouched by any of this.
  it("rejects anchorChainId, which the Vault popup never reads", () => {
    expect(() => parseVaultConfig({ ...valid, anchorChainId: "eip155:10" })).toThrow(/anchorChainId/);
  });

  it("rejects a config that is not an object", () => {
    expect(() => parseVaultConfig(null)).toThrow(VaultConfigError);
    expect(() => parseVaultConfig("a string")).toThrow(VaultConfigError);
  });
});

describe("bakedAppConfig", () => {
  it("defaults operatorName to the rpId rather than to a hardcoded Avok", () => {
    expect(bakedAppConfig(parseVaultConfig(valid)).operatorName).toBe("vault.example1.com");
  });

  it("prefers the operator's own branding when they set it", () => {
    const cfg = parseVaultConfig({ ...valid, branding: { operatorName: "Qudi" } });
    expect(bakedAppConfig(cfg).operatorName).toBe("Qudi");
  });

  it("carries no chain id, because chainId arrives per transaction", () => {
    expect(bakedAppConfig(parseVaultConfig(valid))).not.toHaveProperty("defaultChainId");
  });

  it("omits managementUrl entirely when unset, rather than baking undefined", () => {
    expect(bakedAppConfig(parseVaultConfig(valid))).not.toHaveProperty("managementUrl");
  });

  it("carries the resolved RPC map — what the page's own runtime needs to build an RpcClient", () => {
    const baked = bakedAppConfig(parseVaultConfig(valid));
    expect(baked.rpcUrls).toEqual({ base: "https://mainnet.base.org" });
  });

  // TDD §7: "V1 is anchor-chain-only." There is no separate `anchorChainId` config key (that name is
  // rejected above for a different, unrelated concept — device enrolment's anchor). The FIRST
  // configured chain is used, a v1 default rather than a spec requirement — see recover/mount.ts.
  it("recoveryChainId is the FIRST configured chain's numeric id", () => {
    const cfg = parseVaultConfig({ ...valid, chains: ["base", "ethereum"] });
    expect(bakedAppConfig(cfg).recoveryChainId).toBe(8453);
  });

  it("an rpcOverride wins over the registry default", () => {
    const cfg = parseVaultConfig({ ...valid, rpcOverrides: { base: "https://custom.example.com" } });
    expect(bakedAppConfig(cfg).rpcUrls).toEqual({ base: "https://custom.example.com" });
  });

  // The Vault popup's own runtime (vault/simulate) sees a numeric `chainId` on every sign-tx request,
  // never the registry's friendly name — TDD §5 step 2 needs a chainId-keyed map to build an RpcClient
  // with, not the name-keyed one `connect-src` is pinned from.
  it("also carries the RPC map keyed by numeric chain id, for the runtime's simulate step", () => {
    const baked = bakedAppConfig(parseVaultConfig(valid));
    expect(baked.rpcUrlsByChainId).toEqual({ 8453: "https://mainnet.base.org" });
  });

  it("an rpcOverride is reflected in the chainId-keyed map too", () => {
    const cfg = parseVaultConfig({ ...valid, rpcOverrides: { base: "https://custom.example.com" } });
    expect(bakedAppConfig(cfg).rpcUrlsByChainId).toEqual({ 8453: "https://custom.example.com" });
  });
});

describe("resolveVaultRpcsByChainId", () => {
  it("resolves every configured chain's numeric chainId to its RPC URL", () => {
    const cfg = parseVaultConfig({ ...valid, chains: ["base", "ethereum"] });
    expect(resolveVaultRpcsByChainId(cfg)).toEqual({
      8453: "https://mainnet.base.org",
      1: "https://ethereum-rpc.publicnode.com",
    });
  });
});

describe("resolveVaultRpcs", () => {
  it("resolves every configured chain to its registry default RPC", () => {
    const cfg = parseVaultConfig({ ...valid, chains: ["base", "ethereum"] });
    expect(resolveVaultRpcs(cfg)).toEqual({
      base: "https://mainnet.base.org",
      ethereum: "https://ethereum-rpc.publicnode.com",
    });
  });
});
