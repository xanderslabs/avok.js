import { useEffect, useState } from "react";
import { createAvokClient, createSharedOriginConnection } from "@avokjs/react";
import type { UseOnlyAvokClient } from "@avokjs/react";
import { config } from "./config.js";

// Shared-origin is use-only: the client is the shared UseOnlyAvokClient surface
// (no create/export/enrollAccessSlot/access-slot/pairing).
type State = { client: UseOnlyAvokClient | null; loading: boolean; error: string | null };

/**
 * SHARED-ORIGIN client. The connection is built asynchronously — it dynamically
 * imports @avokjs/core/channel for bundle purity — so this hook exposes
 * loading/error while the auth-origin channel is wired. The wallet's keys live
 * at the operator's auth origin (config.authOrigin); signing ceremonies happen
 * in its popup and only signatures cross back. Reads src/config.ts only (no
 * harness indirection) so the app clones cleanly.
 */
export function useSharedOriginClient(): State {
  const [state, setState] = useState<State>({ client: null, loading: true, error: null });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const connection = await createSharedOriginConnection({
          authOrigin: config.authOrigin,
        });
        const client = createAvokClient({
          connection,
          paymasterUrl: config.paymasterUrl,
          bundlerUrl: config.bundlerUrl,
          koraUrl: config.koraUrl,
          managementUrl: config.managementUrl,
        }, { name: "Avok Demo", rdns: "js.avok.demo" });
        if (live) setState({ client, loading: false, error: null });
      } catch (e) {
        if (live) setState({ client: null, loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return state;
}
