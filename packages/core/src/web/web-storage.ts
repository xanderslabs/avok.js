import type { StorageAdapter } from "../engine.js";

/**
 * Returns a localStorage-backed StorageAdapter.
 * Falls back to an in-memory Map when localStorage is absent or non-functional
 * (SSR, test environments, Node.js 22 built-in localStorage without a storage
 * file, cross-origin iframes with blocked storage, etc.).
 *
 * Evaluated lazily at call time so that each call can independently fall through
 * to the memory path — there is no module-load-time check.
 */
export function webStorage(): StorageAdapter {
  // Guard: localStorage must be present AND fully functional (setItem/getItem must
  // be callable functions). Node.js 22 exposes a globalThis.localStorage stub that
  // passes a null-check but has no Storage prototype methods; checking the method
  // types catches that case without triggering any side-effects.
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
    // Storage access blocked (e.g. cross-origin iframe with cookies disabled).
  }

  if (ls !== null) {
    return {
      get(key: string): string | null {
        return ls!.getItem(key);
      },
      set(key: string, value: string): void {
        ls!.setItem(key, value);
      },
      remove(key: string): void {
        ls!.removeItem(key);
      },
    };
  }

  // Memory fallback for SSR / locked storage environments.
  const map = new Map<string, string>();
  return {
    get(key: string): string | null {
      return map.get(key) ?? null;
    },
    set(key: string, value: string): void {
      map.set(key, value);
    },
    remove(key: string): void {
      map.delete(key);
    },
  };
}
