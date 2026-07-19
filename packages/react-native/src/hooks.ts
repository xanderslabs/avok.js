/**
 * Avok React Native hooks — identical surface to @avokjs/react hooks,
 * re-implemented here to avoid pulling the web-React/DOM graph.
 *
 * Construction/management verbs only; no key handling here. Sending and signing are NOT hooks —
 * on native they go through the wallet's provider surfaces, not a bespoke hook (VISION §6). The old
 * useSend/useSimulate/useSign/useFeeTokens hooks are gone.
 */
import { useCallback, useState } from "react";
import type { UseOnlyAvokClient, FullAvokClient, Account, CreateOpts, ContinueOpts } from "@avokjs/core/engine";
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
    throw new Error(
      "useSelfCustody requires an own-origin (self-custody) connection; this app is shared-origin (use-only)",
    );
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
  const { call, pending, error } = useMutation((o?: CreateOpts) => client.create(o), [client]);
  return { create: call, pending, error };
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

// ─── Management-verb hooks (own-origin / self-custody only) ─────────────────────
// Types are taken from the client's own verbs (Awaited<ReturnType<…>>) so no extra @avokjs/core/engine
// imports are needed and the shapes cannot drift from FullAvokClient.

type EnrollResult = Awaited<ReturnType<FullAvokClient["enrollAccessSlot"]>>;
type ExportedKey = Awaited<ReturnType<FullAvokClient["exportEvmKey"]>>;
type AccessSlot = Awaited<ReturnType<FullAvokClient["listAccessSlots"]>>[number];
type RemoveResult = Awaited<ReturnType<FullAvokClient["removeAccessSlot"]>>;

/**
 * Enroll a NEW passkey as an access slot on THIS device (a secondary), atomically writing its encrypted
 * blob on chain in one funded transaction. For the cross-device / cross-domain QR ceremony, use
 * `usePairingCeremony`.
 */
export function useEnroll(): {
  enroll: () => Promise<EnrollResult>;
  pending: boolean;
  error: Error | null;
} {
  const client = useSelfCustody();
  const { call, pending, error } = useMutation(() => client.enrollAccessSlot(), [client]);
  return { enroll: call, pending, error };
}

/**
 * Reveal the wallet's RAW private keys. The EVM key is the root (Solana derives from it — see VISION §5),
 * so `exportEvmKey` restores the whole wallet on both chains. Each call runs a passkey gesture and
 * returns raw hex, never a seed phrase. Gate this behind an explicit "reveal keys" confirmation.
 */
export function useExport(): {
  exportEvmKey: () => Promise<ExportedKey>;
  exportSolanaKey: () => Promise<ExportedKey>;
  pending: boolean;
  error: Error | null;
} {
  const client = useSelfCustody();
  const evm = useMutation(() => client.exportEvmKey(), [client]);
  const sol = useMutation(() => client.exportSolanaKey(), [client]);
  return {
    exportEvmKey: evm.call,
    exportSolanaKey: sol.call,
    pending: evm.pending || sol.pending,
    error: evm.error ?? sol.error,
  };
}

/**
 * The "who can reach my wallet" settings surface (§6.4). `refresh()` reads the roster from chain and
 * decrypts each slot's enrolling domain — ONE passkey gesture, because the rp-id metadata is encrypted
 * under the wallet key — and reads the chain-verified `count`. It is therefore NOT automatic: `slots`
 * and `count` are `null` until the first `refresh()`.
 *
 * `remove(slotId, { confirm: true })` frees a slot (one gesture — a self-pay tx) and updates local state
 * WITHOUT a second gesture (re-listing would re-decrypt every slot). Removal is HOUSEKEEPING, not a
 * security control — a device that ever signed had the key in memory. To secure a compromised wallet,
 * move the funds.
 */
export function useAccessSlots(): {
  slots: AccessSlot[] | null;
  count: number | null;
  refresh: () => Promise<void>;
  remove: (slotId: ExportedKey, opts: { confirm: true }) => Promise<RemoveResult>;
  pending: boolean;
  error: Error | null;
} {
  const client = useSelfCustody();
  const [slots, setSlots] = useState<AccessSlot[] | null>(null);
  const [count, setCount] = useState<number | null>(null);

  const doRefresh = useCallback(async () => {
    // listAccessSlots costs the gesture (metadata decrypt); accessSlotCount is a plain chain read.
    const [list, n] = await Promise.all([client.listAccessSlots(), client.accessSlotCount()]);
    setSlots(list);
    setCount(n);
  }, [client]);

  const refreshMut = useMutation(doRefresh, [doRefresh]);
  const removeMut = useMutation(
    async (slotId: ExportedKey, opts: { confirm: true }): Promise<RemoveResult> => {
      const r = await client.removeAccessSlot(slotId, opts);
      // Optimistic local update — the slot is gone, count drops by one — so removal costs one gesture,
      // not two.
      setSlots((prev) => prev?.filter((s) => s.slotId.toLowerCase() !== slotId.toLowerCase()) ?? null);
      setCount((c) => (c != null ? c - 1 : null));
      return r;
    },
    [client],
  );

  return {
    slots,
    count,
    refresh: refreshMut.call,
    remove: removeMut.call,
    pending: refreshMut.pending || removeMut.pending,
    error: refreshMut.error ?? removeMut.error,
  };
}
