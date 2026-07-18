/**
 * StorageAdapter defines a minimal key-value storage interface.
 * Implementations can use browser localStorage, sessionStorage, memory, etc.
 *
 * IMPORTANT: Keys and values are NON-SECRET strings only.
 * Never store cryptographic keys, secrets, or sensitive blobs in StorageAdapter.
 */
export interface StorageAdapter {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

/**
 * memoryStorage returns an in-memory Map-backed StorageAdapter.
 * Useful for testing and serverless environments.
 * All operations are synchronous but return values compatible with async/await.
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
