/**
 * SecureStore-backed StorageAdapter for React Native.
 *
 * Design: expo-secure-store is injected via `opts.secureStore` rather than
 * statically imported — this keeps the module importable in test environments
 * (and web) that don't have expo-secure-store installed, and lets unit tests
 * supply a fake without configuring a module mock.
 *
 * Resolution order (called once per `secureStoreStorage()` call):
 *   1. opts.secureStore — explicit injection (tests, custom impl, React Native
 *      modules other than expo-secure-store).
 *   2. localStorage — when running in a web/JSDOM environment (Platform.OS ===
 *      "web" in RN-web, or test environments with a real window.localStorage).
 *   3. Memory fallback — covers edge cases where neither SecureStore nor
 *      localStorage is available (unit tests without jsdom, CI, etc.).
 *
 * IMPORTANT: values stored here are NON-SECRET strings only (session metadata,
 * subname, etc.). Cryptographic key material never passes through here.
 */
import type { StorageAdapter } from "@avokjs/core/engine";

/** Mirrors the async subset of expo-secure-store that this adapter uses. */
export interface SecureStoreShape {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * Returns a StorageAdapter backed by SecureStore on native.
 * Falls back to localStorage (RN-web / JSDOM) or an in-memory map.
 *
 * @param opts.secureStore — inject a SecureStore-compatible implementation.
 *   Pass a fake object in unit tests to avoid needing a real expo-secure-store.
 */
export function secureStoreStorage(opts?: {
  secureStore?: SecureStoreShape;
}): StorageAdapter {
  // ── Path 1: explicit injection ───────────────────────────────────────────
  const ss = opts?.secureStore;
  if (ss) {
    return {
      get: (k) => ss.getItemAsync(k),
      set: (k, v) => ss.setItemAsync(k, v),
      remove: (k) => ss.deleteItemAsync(k),
    };
  }

  // ── Path 2: localStorage (web environment / JSDOM / RN-web) ─────────────
  let ls: Storage | null = null;
  try {
    const candidate =
      typeof window !== "undefined" ? window.localStorage : null;
    if (
      candidate != null &&
      typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function" &&
      typeof candidate.removeItem === "function"
    ) {
      ls = candidate;
    }
  } catch {
    // Blocked in cross-origin iframes or locked storage environments.
  }

  if (ls !== null) {
    // Wrap in Promise.resolve so all three paths have a consistent async contract
    // (SecureStore path is already async via getItemAsync).
    return {
      get: (k) => Promise.resolve(ls!.getItem(k)),
      set: (k, v) => ls!.setItem(k, v),
      remove: (k) => ls!.removeItem(k),
    };
  }

  // ── Path 3: in-memory fallback ────────────────────────────────────────────
  // Covers: Node.js environments without jsdom, edge cases where SecureStore
  // is unavailable at runtime (emulator without Expo runtime, etc.).
  const map = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(map.get(k) ?? null),
    set: (k, v) => { map.set(k, v); },
    remove: (k) => { map.delete(k); },
  };
}
