/**
 * The operator's config, BAKED INTO THIS BUILD.
 *
 * Clone-and-own means the operator builds their own popup with their own config, and
 * `scripts/inline-app.mjs` writes it into the page at build time. It is read from
 * `window.__AVOK_CONFIG__`, and a missing field fails loud at boot.
 *
 * This mirrors `src/app/branding.ts`'s AppConfig — the shape `resolveAppConfig` actually produces.
 * Same name, two declarations, and no compiler to notice if they diverge: keep them one shape.
 */
export interface AppConfig {
  operatorName: string;
  authOrigin: string;
  /** The operator's PINNED rpId. Use it verbatim — NEVER infer an rpId from the URL. An origin on a
   *  subdomain (auth.example.com) has a hostname that is not the rpId (example.com): inferring finds
   *  no passkey, and since K = HKDF(PRF(credential, rpId)) it would derive a DIFFERENT WALLET. */
  rpId: string;
  defaultChainId: number;
  managementUrl?: string;
  paymasterUrl?: string;
  feeToken?: string;
  /** Mirrors `BakedAppConfig.rpcUrlsByChainId` (`packages/vault/src/config.ts`) — what `mountAuthPopup`
   *  needs to simulate a sign-tx request pre-gesture (TDD §5 step 2). */
  rpcUrlsByChainId: Record<number, string>;
}

declare global {
  interface Window {
    __AVOK_CONFIG__?: AppConfig;
  }
}

export function readConfig(): AppConfig {
  const c = window.__AVOK_CONFIG__;
  if (!c) throw new Error("Missing __AVOK_CONFIG__ — the build must bake config into the page");
  // Fail loud rather than fall back to the URL: a wrong rpId silently derives the WRONG WALLET.
  if (!c.rpId) throw new Error("Missing rpId in __AVOK_CONFIG__ — the build must bake the operator's pinned rpId");
  return c;
}
