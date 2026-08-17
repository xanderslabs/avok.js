import { describe, it, expect } from "vitest";
import { buildInitConfig } from "../src/init.js";
import { VaultConfigError } from "../src/config.js";

describe("buildInitConfig", () => {
  it("defaults rpId to the Vault origin's own host, the tightest valid scope", () => {
    const cfg = buildInitConfig({ vaultOrigin: "https://vault.example1.com" });
    expect(cfg.rpId).toBe("vault.example1.com");
  });

  it("keeps an explicit rpId, so an operator can pin a historical value when migrating", () => {
    const cfg = buildInitConfig({ vaultOrigin: "https://vault.example1.com", rpId: "example1.com" });
    expect(cfg.rpId).toBe("example1.com");
  });

  it("rejects an explicit rpId that WebAuthn would refuse", () => {
    expect(() => buildInitConfig({ vaultOrigin: "https://vault.example1.com", rpId: "attacker.com" })).toThrow(
      /registrable domain suffix/,
    );
  });

  it("records the operator name when given", () => {
    const cfg = buildInitConfig({ vaultOrigin: "https://vault.example1.com", operatorName: "Qudi" });
    expect(cfg.branding?.operatorName).toBe("Qudi");
  });

  it("asks for no chain, because Avok is multichain and chainId is per transaction", () => {
    expect(buildInitConfig({ vaultOrigin: "https://vault.example1.com" })).not.toHaveProperty("anchorChainId");
  });

  // `init` is the first thing an operator runs, and a typed origin is the first thing they type.
  // `new URL` throws a bare TypeError ("Invalid URL"), which says nothing about what to fix.
  it("explains an unparseable origin instead of throwing a bare TypeError", () => {
    expect(() => buildInitConfig({ vaultOrigin: "vault.example1.com" })).toThrow(VaultConfigError);
    expect(() => buildInitConfig({ vaultOrigin: "vault.example1.com" })).toThrow(/https:\/\//);
  });

  it("still refuses plaintext, since init is where the mistake is cheapest to catch", () => {
    expect(() => buildInitConfig({ vaultOrigin: "http://vault.example1.com" })).toThrow(/https/);
  });

  it("allows an http localhost origin, so a developer can get started", () => {
    const cfg = buildInitConfig({ vaultOrigin: "http://localhost:5173" });
    expect(cfg.rpId).toBe("localhost");
  });
});
