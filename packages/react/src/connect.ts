/**
 * useAvokConnect — the WalletConnect-style trigger a shared-origin dapp reaches for.
 *
 * `connect()` runs the sign-in ceremony in the operator's auth-origin popup (client.login()); the
 * wallet's keys never cross the boundary — only the account comes back. It composes the existing
 * login mutation + reactive account into the single hook the "Connect" button binds to. Sending and
 * signing are NOT hooks — they go through the announced provider (VISION §6 Surface 1).
 */
import { useCallback, useState } from "react";
import type { Account } from "@avokjs/core";
import { useAvokContext } from "./provider.js";

/** Derive a display name for an auth origin (its hostname). Falls back to the raw string. Exported so
 *  a dapp's "Continue with …" copy needn't re-implement it. Display only — never affects signing. */
export function operatorNameFromOrigin(authOrigin: string): string {
  try {
    return new URL(authOrigin).hostname;
  } catch {
    return authOrigin;
  }
}

export function useAvokConnect(): {
  connect: () => Promise<void>;
  isPending: boolean;
  error: Error | null;
  account: Account | null;
  isConnected: boolean;
} {
  const { client, account, status } = useAvokContext();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const connect = useCallback(async (): Promise<void> => {
    setIsPending(true);
    setError(null);
    try {
      await client.login();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [client]);

  return { connect, isPending, error, account, isConnected: status };
}
