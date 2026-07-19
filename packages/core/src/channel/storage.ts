import type { SharedAccount } from "./types.js";

/**
 * StorageAdapter defines a minimal key-value storage interface.
 * Implementations can use browser localStorage, sessionStorage, memory, etc.
 *
 * DELIBERATELY SYNC, and deliberately distinct from the root `../storage.js` StorageAdapter (which is
 * Promise-capable for React Native's async SecureStore on the own-origin/RN rail). The shared-origin
 * channel is browser-only today (native shared-origin is a follow-on — see VISION §8), and its
 * `account()`/`status()` are synchronous surface, so its persistence (`loadAccount`) must read
 * synchronously. Unifying the two would either break RN storage (forcing root sync) or make the
 * shared-origin client's `status()`/`account()` async (a public-API regression). Revisit if/when the
 * native shared-origin channel ships and this rail needs async storage.
 */
export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * memoryStorage returns an in-memory Map-backed StorageAdapter.
 * Useful for testing and serverless environments.
 */
export function memoryStorage(): StorageAdapter {
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

const ACCOUNT_KEY = "avok.account";

/**
 * Persist the connected account.
 *
 * This is not a session and there is nothing secret in it — #8 deleted the tokens. What is stored is
 * the user's public address (plus the credentialId that lets the popup skip the passkey picker). It
 * cannot authorise anything: every action is a fresh passkey gesture on the auth origin.
 *
 * NEVER stores cryptographic keys.
 */
export function saveAccount(storage: StorageAdapter, account: SharedAccount): void {
  storage.set(ACCOUNT_KEY, JSON.stringify(account));
}

/**
 * Read the persisted account. Returns null if absent or unparseable (defensive: never throws).
 *
 * There is no expiry check any more, and that is not an omission. Expiry existed because the session
 * WAS a bearer token that the origin would eventually refuse — restoring a dead one rendered the app
 * as signed-in until the user tried to sign, which is the worst moment to find out. A public address
 * cannot go stale that way: it authorises nothing, so there is nothing to expire. The only way to
 * "sign out" is `logout()`, which clears this.
 */
export function loadAccount(storage: StorageAdapter): SharedAccount | null {
  const value = storage.get(ACCOUNT_KEY);
  if (value === null) return null;
  try {
    return JSON.parse(value) as SharedAccount;
  } catch {
    return null;
  }
}

/** Forget the connected account. */
export function clearAccount(storage: StorageAdapter): void {
  storage.remove(ACCOUNT_KEY);
}
