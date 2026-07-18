/**
 * The operator's config, BAKED INTO THIS BUILD.
 *
 * #8: it used to be injected per request by the origin's server (`render.ts`). There is no server —
 * clone-and-own means the operator builds their own popup with their own config, and
 * `scripts/inline-app.mjs` writes it into the page at build time. The read is unchanged
 * (`window.__AVOK_CONFIG__`), and so is the fail-loud: it just fires at build/boot instead of per
 * request.
 *
 * This mirrors `src/app/branding.ts`'s AppConfig — the shape `resolveAppConfig` actually produces.
 * The two had DRIFTED: this one still declared `subnameParent`/`subnameRegistrar` (dead since #6
 * removed them from the origin's config) and omitted `defaultChainId`, which the popup is really
 * given. Same name, different types, and no compiler to notice — so they are one shape now.
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
