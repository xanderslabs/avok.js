import type { Eip1193Provider } from "./eip1193.js";

/** EIP-6963 provider metadata a wallet advertises for discovery. */
export interface Eip6963ProviderInfo {
  /** A fresh UUIDv4, per announcement session. */
  uuid: string;
  name: string;
  /** A data: URI (EIP-6963 forbids remote icon URLs). */
  icon: string;
  /** Reverse-DNS wallet identifier, e.g. "com.avok". */
  rdns: string;
}

/**
 * Announce an EIP-1193 provider via EIP-6963 so viem/wagmi/ethers/AppKit discover it with no Avok
 * import: emit `eip6963:announceProvider` once immediately and on every `eip6963:requestProvider`.
 * Returns a cleanup that stops answering. No-ops (returns a no-op cleanup) when there is no `window`
 * (SSR), since discovery is a browser-only concern.
 */
export function announceEip6963(provider: Eip1193Provider, info: Eip6963ProviderInfo): () => void {
  if (typeof window === "undefined") return () => {};

  // EIP-6963 requires the event detail to be frozen so consumers can't mutate the shared record.
  const detail = Object.freeze({ info: Object.freeze({ ...info }), provider });
  const announce = (): void => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  };

  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  return () => window.removeEventListener("eip6963:requestProvider", announce);
}
