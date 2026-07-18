/**
 * AvokProvider — holds the AvokClient in React context and keeps
 * reactive {account, status} in sync after each ceremony (create /
 * continue / import / logout / pairing).
 *
 * Reactivity mechanism: the provider subscribes to the client's `subscribe()`
 * change event. The client itself fires it after any state-moving verb, so the
 * provider observes rather than mutating the client object. Re-subscribes and
 * resyncs whenever the `client` prop identity changes.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UseOnlyAvokClient, Account } from "@avokjs/core";

// ─── Context ─────────────────────────────────────────────────────────────────

interface AvokContextValue {
  client: UseOnlyAvokClient;
  account: Account | null;
  status: boolean;
}

const AvokContext = createContext<AvokContextValue | null>(null);

/** @internal — used by hooks. Throws when called outside <AvokProvider>. */
export function useAvokContext(): AvokContextValue {
  const ctx = useContext(AvokContext);
  if (!ctx) throw new Error("Avok hooks must be used inside <AvokProvider>");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AvokProvider({
  client,
  children,
}: {
  client: UseOnlyAvokClient;
  children: ReactNode;
}): React.JSX.Element {
  const [snap, setSnap] = useState<{ account: Account | null; status: boolean }>(
    () => ({ account: client.account(), status: client.status() }),
  );

  useEffect(() => {
    // Resync on subscribe: covers a changed `client` prop and any state that moved
    // between render and effect. Then observe the client's change event.
    const read = () => setSnap({ account: client.account(), status: client.status() });
    read();
    return client.subscribe(read);
  }, [client]);

  const value = useMemo<AvokContextValue>(
    () => ({ client, account: snap.account, status: snap.status }),
    [client, snap],
  );

  return <AvokContext.Provider value={value}>{children}</AvokContext.Provider>;
}
