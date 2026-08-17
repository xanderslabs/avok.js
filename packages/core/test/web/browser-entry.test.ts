import { describe, it, expect } from "vitest";
import { createSharedOriginConnection, webStorage } from "../../src/index.js";

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
