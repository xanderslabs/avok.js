/**
 * Avok React Native hooks — identical surface to @avokjs/react hooks,
 * re-implemented here to avoid pulling the web-React/DOM graph.
 *
 * Thin state wrappers only; no key handling here. Sending and signing are NOT hooks — on native they
 * go through the wallet's provider surfaces, not a bespoke hook (VISION §6).
 *
 * Wallet lifecycle beyond login (create, guardians, recovery, devices) is the vault's own surface —
 * there is no more own-origin custody posture to gate a "self-custody" hook family behind (D3:
 * popup-for-all).
 */
import { useCallback, useState } from "react";
import type { AvokClient, Account, ContinueOpts } from "@avokjs/core/engine";
import { useAvokContext } from "./provider.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a pending/error wrapper around an async op that delegates to the client. */
function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  deps: unknown[],
): { call: (...args: TArgs) => Promise<TResult>; pending: boolean; error: Error | null } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const call = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setPending(false);
      }
    },
    // fn itself is stable (created with useCallback in callers) so spreading deps is correct
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  return { call, pending, error };
}

// ─── Public hooks ─────────────────────────────────────────────────────────────

/** Returns the AvokClient from context. */
export function useAvok(): AvokClient {
  return useAvokContext().client;
}

/** Reactive account + session status. Updates after every ceremony/logout. */
export function useAccount(): { account: Account | null; status: boolean } {
  const { account, status } = useAvokContext();
  return { account, status };
}

/** Log in to (recover / resume) an existing account. */
export function useLogin(): {
  login: (o?: ContinueOpts) => Promise<Account>;
  pending: boolean;
  error: Error | null;
} {
  const { client } = useAvokContext();
  const { call, pending, error } = useMutation((o?: ContinueOpts) => client.login(o), [client]);
  return { login: call, pending, error };
}

/** Logout and clear session. */
export function useLogout(): {
  logout: () => Promise<void>;
  pending: boolean;
  error: Error | null;
} {
  const { client } = useAvokContext();
  const { call, pending, error } = useMutation(async () => {
    await (client.logout() as Promise<void> | void);
  }, [client]);
  return { logout: call, pending, error };
}
