/**
 * TDD Step 1 (from brief): secureStoreStorage delegates to the injected SecureStore.
 * This test is written BEFORE the implementation exists — it must fail RED first.
 */
import { describe, it, expect } from "vitest";
import { secureStoreStorage } from "../src/native-storage.js";

// ─── Fake SecureStore (injectable DI seam) ────────────────────────────────────

function makeFakeSecureStore() {
  const map = new Map<string, string>();
  return {
    getItemAsync: async (key: string): Promise<string | null> =>
      map.get(key) ?? null,
    setItemAsync: async (key: string, value: string): Promise<void> => {
      map.set(key, value);
    },
    deleteItemAsync: async (key: string): Promise<void> => {
      map.delete(key);
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("secureStoreStorage (injected fake)", () => {
  it("delegates to the injected SecureStore (brief Step 1)", async () => {
    const fakeStore = makeFakeSecureStore();
    const s = secureStoreStorage({ secureStore: fakeStore });
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
  });

  it("returns null for a key that was never set", async () => {
    const fakeStore = makeFakeSecureStore();
    const s = secureStoreStorage({ secureStore: fakeStore });
    expect(await s.get("missing")).toBeNull();
  });

  it("remove deletes the key", async () => {
    const fakeStore = makeFakeSecureStore();
    const s = secureStoreStorage({ secureStore: fakeStore });
    await s.set("x", "y");
    await s.remove("x");
    expect(await s.get("x")).toBeNull();
  });

  it("multiple keys are stored independently", async () => {
    const fakeStore = makeFakeSecureStore();
    const s = secureStoreStorage({ secureStore: fakeStore });
    await s.set("a", "1");
    await s.set("b", "2");
    expect(await s.get("a")).toBe("1");
    expect(await s.get("b")).toBe("2");
  });
});

describe("secureStoreStorage (no injection — localStorage fallback)", () => {
  it("falls back to localStorage in a web/jsdom environment", async () => {
    // In jsdom, window.localStorage is available.
    const s = secureStoreStorage();
    await s.set("fallback-k", "fallback-v");
    expect(await s.get("fallback-k")).toBe("fallback-v");
    await s.remove("fallback-k");
    expect(await s.get("fallback-k")).toBeNull();
  });
});
