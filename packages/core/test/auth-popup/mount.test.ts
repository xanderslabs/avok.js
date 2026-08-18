// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { authPopupDeps, mountAuthPopup } from "../../src/auth-popup/mount.js";
import type { AuthPopupConfig } from "../../src/auth-popup/ceremony.js";

/**
 * `authPopupDeps.simulate` is the seam where the RPC client actually gets built — see mount.ts's
 * header comment. The real-network happy path (build a viem client, call `simulateRequest`) is
 * exercised the same way the rest of this file's WebAuthn-driven gestures are: by the device-gated
 * suites, not a unit test with a fake network. What IS unit-testable, deterministically, is the
 * config-driven branch: a request for a chain the operator never configured an RPC for.
 */
describe("authPopupDeps.simulate", () => {
  const baseConfig: AuthPopupConfig = {
    operatorName: "Test Vault",
    authOrigin: "https://dapp.example",
    rpId: "wallet.example",
    rpcUrlsByChainId: { 8453: "https://mainnet.base.org" },
  };

  it("rejects rather than silently guessing when no RPC is configured for the payload's chain", async () => {
    const deps = authPopupDeps(baseConfig);
    await expect(
      deps.simulate({
        chainId: 999999, // not in rpcUrlsByChainId
        account: "0xcB994f2B438e19C9e444A77c95A8D649F047A180",
        calls: [{ to: "0xcB994f2B438e19C9e444A77c95A8D649F047A180", value: 0n, data: "0x" }],
      }),
    ).rejects.toThrow(/no rpc configured/i);
  });
});

/**
 * ONE PAGE, A THIRD REQUEST KIND. `mountAuthPopup` already branches on how the page was opened
 * (redirect-driven vs. popup-driven — see its own header comment). Direct navigation — no request in
 * the URL fragment AND no `window.opener` — used to fall through to the popup branch anyway, posting
 * `ready` into the void and waiting forever for a message that could never arrive. TDD §7's "Recover a
 * wallet" entry point is exactly this: someone visits the Vault URL directly.
 */
describe("mountAuthPopup: direct navigation (no opener, no redirect request)", () => {
  const recoverConfig: AuthPopupConfig = {
    operatorName: "Test Vault",
    authOrigin: "https://dapp.example",
    rpId: "wallet.example",
    recoveryChainId: 8453,
    rpcUrlsByChainId: { 8453: "https://mainnet.base.org" },
  };

  it("mounts the recover screen rather than waiting on a popup message that will never come", () => {
    const root = document.createElement("div");
    // jsdom's default window.opener is null and its default location carries no request fragment —
    // exactly the direct-navigation case.
    mountAuthPopup(recoverConfig, root);
    expect(root.textContent).toMatch(/recover a wallet/i);
  });
});
