import { describe, it, expect, expectTypeOf } from "vitest";
import { createOwnOriginConnection, createSharedOriginConnection, webStorage } from "../../src/index.js";
import type { SolanaTxOpts, SolanaNamespace, SolanaResolved, SolanaSimulation, FeeToken } from "../../src/index.js";

describe("createOwnOriginConnection", () => {
  // Step 1 (TDD): failing test — own-origin entry point wires the web trio.
  // Asserts the returned Connection has all required verbs.
  // The WebAuthnPasskeyAdapter constructor is free (no credentials calls until
  // create/authenticate/discover), so no navigator stubs needed here.
  it("injects a WebAuthn passkey adapter and web storage (returns Connection verbs)", () => {
    const conn = createOwnOriginConnection({ rpId: "qudi.fi" });
    expect(typeof conn.create).toBe("function");
    expect(typeof conn.continue).toBe("function");
    expect(typeof conn.export).toBe("function");
    expect(typeof conn.logout).toBe("function");
    expect(typeof conn.account).toBe("function");
    expect(typeof conn.status).toBe("function");
    expect(typeof conn.signMessage).toBe("function");
    expect(conn.canExport).toBe(true);
  });

  it("accepts a custom storage override", () => {
    const mem = new Map<string, string>();
    const storage = {
      get: (k: string) => mem.get(k) ?? null,
      set: (k: string, v: string) => {
        mem.set(k, v);
      },
      remove: (k: string) => {
        mem.delete(k);
      },
    };
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", storage });
    expect(typeof conn.create).toBe("function");
  });
});

describe("createSharedOriginConnection", () => {
  // Bundle-purity guard: createSharedOriginConnection MUST be async so
  // bundlers see the dynamic-import boundary and can code-split the shared-origin transport.
  it("is an async function (bundle-purity guard)", () => {
    expect(createSharedOriginConnection.constructor.name).toBe("AsyncFunction");
  });

  it("matches the async function prototype", () => {
    expect(Object.getPrototypeOf(createSharedOriginConnection)).toBe(Object.getPrototypeOf(async function () {}));
  });
});

describe("webStorage", () => {
  it("round-trips a value via jsdom localStorage", async () => {
    const s = webStorage();
    await s.set("avok:test-key", "hello");
    expect(await s.get("avok:test-key")).toBe("hello");
    await s.remove("avok:test-key");
    expect(await s.get("avok:test-key")).toBeNull();
  });

  it("returns null for a key that was never set", async () => {
    const s = webStorage();
    expect(await s.get("avok:nonexistent")).toBeNull();
  });

  it("falls back to memory when localStorage is absent", async () => {
    // Temporarily hide localStorage to simulate SSR or a locked storage env.
    const origDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const s = webStorage();
      await s.set("k2", "fallback");
      expect(await s.get("k2")).toBe("fallback");
      await s.remove("k2");
      expect(await s.get("k2")).toBeNull();
    } finally {
      // Restore original descriptor
      if (origDesc) {
        Object.defineProperty(globalThis, "localStorage", origDesc);
      }
    }
  });
});

describe("vanilla Solana type surface", () => {
  it("re-exports the Solana types from sdk-core", () => {
    expectTypeOf<SolanaTxOpts>().not.toBeAny();
    expectTypeOf<SolanaNamespace>().not.toBeAny();
    expectTypeOf<SolanaResolved>().not.toBeAny();
    expectTypeOf<SolanaSimulation>().not.toBeAny();
    expectTypeOf<FeeToken>().toMatchTypeOf<{ symbol: string; mint: string }>();
  });
});
