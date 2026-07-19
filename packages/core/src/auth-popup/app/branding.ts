import type { OriginConfig } from "../config.js";
import type { AuthPopupConfig } from "../ceremony.js";

/** eip155:<n> → <n>; anchorChainId defaults to Optimism (10). */
function chainIdFrom(config: OriginConfig): number {
  const id = config.anchorChainId ?? "eip155:10";
  const n = Number(id.replace("eip155:", ""));
  if (!Number.isFinite(n)) throw new Error(`Cannot derive a numeric chainId from anchorChainId "${id}"`);
  return n;
}

/** Resolve the operator's OriginConfig into the popup's config (AuthPopupConfig — the one shape the
 *  ceremony + mount consume). */
export function resolveAppConfig(config: OriginConfig): AuthPopupConfig {
  return {
    // Default to the operator's OWN rpId, never a hardcoded "Avok". This is the operator's wallet
    // (white-label — VISION §1/§8); operatorName is its display name (WebAuthn rp.name + popup
    // branding), so it must be theirs. Matches own-origin's `operatorName ?? rpId`.
    operatorName: config.branding?.operatorName ?? config.rpId,
    authOrigin: config.authOrigin,
    rpId: config.rpId,
    defaultChainId: chainIdFrom(config),
    managementUrl: config.managementUrl,
    paymasterUrl: config.paymasterUrl,
    feeToken: config.feeToken,
  };
}
