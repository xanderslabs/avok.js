/**
 * Avok React hooks — construction/management verbs over the AvokClient; no key handling here.
 *
 * Sending and signing are NOT hooks: they go through the announced EIP-1193 provider (EVM) and the
 * Solana Wallet Standard wallet (VISION §6 Surface 1), driven by stock wagmi/viem / @solana/wallet-adapter.
 * The old useSend/useSimulate/useSign/useFeeTokens hooks are gone.
 */
import { useCallback, useState } from "react";
// Types are sourced from @avokjs/core (a published dep whose .d.ts inlines
// the private sdk-core types) so this package's published .d.ts stays self-contained.
import type { UseOnlyAvokClient, FullAvokClient, Account, CreateOpts, ContinueOpts } from "@avokjs/core";
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

/** Returns the use-only AvokClient from context (own-origin AND shared-origin). */
export function useAvok(): UseOnlyAvokClient {
  return useAvokContext().client;
}

/**
 * Own-origin-only client. Throws if the active connection is shared-origin (use-only).
 * Use for custody-management verbs (`create`/`exportEvmKey`/`enrollAccessSlot`)
 * that only exist on self-custody connections.
 */
export function useSelfCustody(): FullAvokClient {
  const { client } = useAvokContext();
  if (client.custody !== "self") {
    throw new Error("useSelfCustody requires an own-origin (self-custody) connection; this app is shared-origin (use-only)");
  }
  return client as FullAvokClient;
}

/** Reactive account + session status. Updates after every ceremony/logout. */
export function useAccount(): { account: Account | null; status: boolean } {
  const { account, status } = useAvokContext();
  return { account, status };
}

/** Create a new account. Exposes pending + error state. */
export function useCreate(): {
  create: (o?: CreateOpts) => Promise<Account>;
  pending: boolean;
  error: Error | null;
} {
  const client = useSelfCustody();
  const { call, pending, error } = useMutation(
    (o?: CreateOpts) => client.create(o),
    [client],
  );
  return { create: call, pending, error };
}

/** Log in to (recover / resume) an existing account. */
export function useLogin(): {
  login: (o?: ContinueOpts) => Promise<Account>;
  pending: boolean;
  error: Error | null;
} {
  const { client } = useAvokContext();
  const { call, pending, error } = useMutation(
    (o?: ContinueOpts) => client.login(o),
    [client],
  );
  return { login: call, pending, error };
}

/** Logout and clear session. */
export function useLogout(): {
  logout: () => Promise<void>;
  pending: boolean;
  error: Error | null;
} {
  const { client } = useAvokContext();
  const { call, pending, error } = useMutation(
    async () => { await (client.logout() as Promise<void> | void); },
    [client],
  );
  return { logout: call, pending, error };
}
