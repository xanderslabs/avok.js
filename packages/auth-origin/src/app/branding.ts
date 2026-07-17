import type { OriginConfig } from "../config.js";

export interface AppBranding {
  operatorName: string;
}

/** The client AppConfig shape injected as window.__AVOK_CONFIG__ (mirrors app/src/config.ts). */
export interface AppConfig {
  operatorName: string;
  authOrigin: string;
  /** The operator's PINNED rpId. The popups must use this verbatim and must NEVER infer an rpId
   *  from the URL: an origin mounted on a subdomain (auth.example.com) has a hostname that is NOT
   *  the rpId (example.com), so inferring it finds no passkey — and since
   *  K = HKDF(PRF(credential, rpId)), it would derive a DIFFERENT WALLET. See config.ts, which calls
   *  an inferred-from-URL rpId a wallet-drain security defect. */
  rpId: string;
  defaultChainId: number;
  managementUrl?: string;
  paymasterUrl?: string;
  feeToken?: string;
}

/** eip155:<n> → <n>; anchorChainId defaults to Optimism (10). */
function chainIdFrom(config: OriginConfig): number {
  const id = config.anchorChainId ?? "eip155:10";
  const n = Number(id.replace("eip155:", ""));
  if (!Number.isFinite(n)) throw new Error(`Cannot derive a numeric chainId from anchorChainId "${id}"`);
  return n;
}

export function resolveAppConfig(config: OriginConfig): AppConfig {
  return {
    operatorName: config.branding?.operatorName ?? "Avok",
    authOrigin: config.authOrigin,
    rpId: config.rpId,
    defaultChainId: chainIdFrom(config),
    managementUrl: config.managementUrl,
    paymasterUrl: config.paymasterUrl,
    feeToken: config.feeToken,
  };
}
