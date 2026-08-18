// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { recoverCeremonyDeps } from "../../../src/auth-popup/recover/mount.js";
import type { AuthPopupConfig } from "../../../src/auth-popup/ceremony.js";

/**
 * `recoverCeremonyDeps` is the seam where the recovery screen's real gestures (passkey, EIP-6963,
 * RPC) get built — see mount.ts's header. The real-network/real-WebAuthn happy path is exercised the
 * same way the rest of this file's device-gated suites are: by hand, not a unit test with a fake
 * browser. What IS unit-testable, deterministically, is the config-driven failure: no RPC configured
 * for the anchor chain at all, which must fail LOUD (never silently pick some other chain).
 */
describe("recoverCeremonyDeps", () => {
  it("throws when the config carries no RPC for its own recoveryChainId", () => {
    const config: AuthPopupConfig = {
      operatorName: "Test Vault",
      authOrigin: "https://dapp.example",
      rpId: "wallet.example",
      recoveryChainId: 8453,
      rpcUrlsByChainId: { 10: "https://mainnet.optimism.io" }, // 8453 missing
    };
    expect(() => recoverCeremonyDeps(config)).toThrow(/no rpc configured/i);
  });

  it("throws when the config carries no recoveryChainId at all", () => {
    const config: AuthPopupConfig = {
      operatorName: "Test Vault",
      authOrigin: "https://dapp.example",
      rpId: "wallet.example",
      rpcUrlsByChainId: { 8453: "https://mainnet.base.org" },
    };
    expect(() => recoverCeremonyDeps(config)).toThrow(/recoveryChainId/);
  });
});
