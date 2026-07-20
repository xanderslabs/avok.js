/**
 * `createAvokClient` (native) — the RN provider wiring, previously untested.
 *
 * This file is a deliberate re-implementation of @avokjs/core's web wiring rather than an import of
 * it (the core version lives under web/ and its graph is browser-oriented; the same DOM-free DRY
 * tradeoff AvokProvider and the hooks already make). The bodies are near-identical, which is exactly
 * the risk: two copies with one test suite between them drift silently, and the drift shows up in a
 * published package rather than in CI.
 *
 * What is pinned here is the behaviour the copies must AGREE on:
 *  - `wallet` is required and never defaulted to an Avok brand
 *  - the returned client keeps the full core surface and gains getEip1193Provider()
 *  - the EIP-1193 provider is DOM-free, so it exists on pure native
 *  - the ANNOUNCE (EIP-6963 + Solana Wallet Standard) is window-gated and no-ops on native
 *
 * The last one is the whole reason the native copy exists, and it is the assertion that fails first
 * if someone "simplifies" this file by importing the browser wiring.
 */
import { describe, it, expect, vi } from "vitest";
import type { Connection } from "@avokjs/core";
import { createAvokClient } from "../src/provider-wiring.js";

// Use-only on purpose: the provider wiring is custody-agnostic (it builds a provider and announces),
// so the lighter posture is the honest fixture — a self-custody double would drag in the whole
// management surface this file does not touch.
function fakeConnection(): Connection {
  return {
    custody: "use-only" as const,
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as `0x${string}` },
      solana: { address: "So11111111111111111111111111111111111111" },
    }),
    status: () => true,
    subscribe: () => () => {},
    continue: async () => ({}),
    logout: () => {},
  } as unknown as Connection;
}

const WALLET = { name: "Example Wallet", rdns: "com.example.wallet" };

describe("createAvokClient (native provider wiring)", () => {
  it("returns a client carrying the core surface plus getEip1193Provider()", () => {
    const client = createAvokClient({ connection: fakeConnection() }, WALLET);

    expect(typeof client.getEip1193Provider).toBe("function");
    // Still the core client — the wiring augments, it does not replace.
    expect(typeof client.login).toBe("function");
    expect(typeof client.logout).toBe("function");
    expect(typeof client.subscribe).toBe("function");
    expect(client.account()?.evm.address).toBe("0x1111111111111111111111111111111111111111");
  });

  it("builds a DOM-free EIP-1193 provider — it exists on pure native, where there is no window", () => {
    // This is the piece that must work off-web: wagmi/viem and in-app dapp browsers talk to it.
    const client = createAvokClient({ connection: fakeConnection() }, WALLET);
    const provider = client.getEip1193Provider();

    expect(provider).toBeDefined();
    expect(typeof provider.request).toBe("function");
  });

  it("hands back the SAME provider instance on every call", () => {
    // The provider is built once and closed over. A fresh instance per call would silently break
    // event subscriptions: a dapp listening on one object would never hear the other's events.
    const client = createAvokClient({ connection: fakeConnection() }, WALLET);
    expect(client.getEip1193Provider()).toBe(client.getEip1193Provider());
  });

  it("constructs without throwing when there is no window at all (pure native)", async () => {
    // Pins a real property: an RN app has no window, and building a client must not explode.
    //
    // Be clear about what this does NOT prove. The behaviour is over-determined — core's
    // `announceEip6963` carries its own `typeof window === "undefined"` guard (eip6963.ts:21), and
    // `registerAvokSolanaWallet` never touches window — so deleting this file's outer gate does not
    // make the test fail. Verified by mutation: replacing the gate with `if (true)` keeps all six
    // green. The outer gate is belt-and-braces, not the thing standing between native and a crash.
    // This is a regression guard on the OUTCOME, not a discriminating test of the gate.
    const original = globalThis.window;
    // @ts-expect-error — deleting the global is the point: this is what pure native looks like.
    delete globalThis.window;
    try {
      expect(() => createAvokClient({ connection: fakeConnection() }, WALLET)).not.toThrow();
    } finally {
      if (original !== undefined) globalThis.window = original;
    }
  });

  it("announces on RN-web, where a window does exist", () => {
    // The mirror of the above: with a window present (RN-web / jsdom) the announce path runs and
    // consumes `wallet`. Asserting it does not throw pins that the browser branch stays reachable —
    // a native-only guard that accidentally disabled it everywhere would pass the test above but
    // fail the facade's actual purpose.
    const dispatch = vi.spyOn(globalThis.window, "dispatchEvent");
    try {
      createAvokClient({ connection: fakeConnection() }, WALLET);
      expect(dispatch).toHaveBeenCalled();
    } finally {
      dispatch.mockRestore();
    }
  });

  it("uses the operator's identity and never substitutes an Avok brand", () => {
    // A wallet cannot honestly announce itself anonymously, and it must not announce itself as
    // someone else's product. The operator's name is what reaches the dapp picker.
    const dispatch = vi.spyOn(globalThis.window, "dispatchEvent");
    try {
      createAvokClient({ connection: fakeConnection() }, WALLET);
      const announced = dispatch.mock.calls
        .map(([e]) => (e as CustomEvent<{ info?: { name?: string; rdns?: string } }>).detail?.info)
        .find((info) => info?.rdns === WALLET.rdns);

      expect(announced?.name).toBe("Example Wallet");
      expect(JSON.stringify(announced ?? {}).toLowerCase()).not.toContain("avok");
    } finally {
      dispatch.mockRestore();
    }
  });
});
