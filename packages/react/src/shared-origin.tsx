/**
 * <SharedOrigin> — the shared-origin front door. It does the async wiring a shared-origin dapp would
 * otherwise hand-roll: build the popup-backed connection (which dynamically imports the channel for
 * bundle purity), construct the client, and render <AvokProvider> underneath. `fallback` shows while
 * the connection wires; `onError` surfaces a wiring failure. The wallet's keys live at `auth`; signing
 * ceremonies run in its popup and only signatures cross back.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createAvokClient, createSharedOriginConnection } from "@avokjs/core";
import type { UseOnlyAvokClient, WalletInfo } from "@avokjs/core";
import { AvokProvider } from "./provider.js";

export function SharedOrigin({
  auth,
  wallet,
  paymasterUrl,
  bundlerUrl,
  koraUrl,
  managementUrl,
  fallback,
  onError,
  children,
}: {
  /** The operator's auth origin — the popup to open, and the ONLY origin whose replies are trusted. */
  auth: string;
  /** This wallet's identity in dapp pickers (EIP-6963 + Solana Wallet Standard) — operator-provided. */
  wallet: WalletInfo;
  paymasterUrl?: string;
  bundlerUrl?: string;
  koraUrl?: string;
  managementUrl?: string;
  /** Rendered while the connection wires (the channel import is async). */
  fallback?: ReactNode;
  /** Called if wiring the connection/client fails. */
  onError?: (e: Error) => void;
  children: ReactNode;
}): React.JSX.Element {
  const [client, setClient] = useState<UseOnlyAvokClient | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const connection = await createSharedOriginConnection({ authOrigin: auth });
        const c = createAvokClient({ connection, paymasterUrl, bundlerUrl, koraUrl, managementUrl }, wallet);
        if (live) setClient(c);
      } catch (e) {
        if (live) onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      live = false;
    };
    // Re-wire only when the auth origin changes; client config is read at wire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  if (!client) return <>{fallback ?? null}</>;
  return <AvokProvider client={client}>{children}</AvokProvider>;
}
