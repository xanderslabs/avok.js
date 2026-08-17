import type { OriginConfig } from "../config.js";
import type { AuthPopupConfig } from "../ceremony.js";

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
    managementUrl: config.managementUrl,
    paymasterUrl: config.paymasterUrl,
    feeToken: config.feeToken,
  };
}
