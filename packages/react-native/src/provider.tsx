/**
 * AvokProvider for React Native — thin re-implementation over the same React
 * context pattern as `@avokjs/react`.
 *
 * WHY NOT re-export from @avokjs/react?
 * The `@avokjs/react` package is configured with `platform: "browser"` in
 * tsup and its peer graph pulls react-dom. Importing it here would drag DOM /
 * web-React into the RN bundle graph. Re-implementing the small provider
 * (~60 lines) keeps the RN graph DOM-free. The DRY tradeoff is intentional and
 * documented.
 *
 * Surface is identical to @avokjs/react's AvokProvider + useAvokContext.
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
  children?: ReactNode;
}): React.JSX.Element {
  const [snap, setSnap] = useState<{ account: Account | null; status: boolean }>(
    () => ({ account: client.account(), status: client.status() }),
  );

  useEffect(() => {
    // Resync on subscribe (covers a changed `client` prop), then observe the
    // client's change event — the client fires it after every state-moving verb.
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
