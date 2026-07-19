import type { ChainId } from "@avokjs/contracts";

/**
 * What the auth-origin POPUP needs to be built.
 *
 * #8 deleted the server, so this is no longer a server's config: there is no issuer, no signing key,
 * no client registration, and no store. What is left is the handful of values the operator bakes
 * into their own clone-and-own build of the popup (VISION §7).
 *
 * `relatedOrigins` is gone and was NOT rehomed. Related Origin Requests are OWN-ORIGIN's mechanism
 * (VISION §6: "no popup, no server"), the file must sit at the rpId ROOT, and the standard already
 * carries the tooling (passkey-access-vault reference/src/related-origins.ts + vectors). Serving it
 * here was only ever an artifact of an auth origin sometimes happening to sit at the rpId root — so
 * an operator now drops that static JSON at whatever host IS their rpId root.
 *
 * `clientRegistration` is gone too. `curated` gatekept which dapps a user could reach, "which the
 * model does not do" — the popup exists precisely to serve an UNBOUNDED third-party set (VISION §6),
 * open/MetaMask-style. Anybody can implement the connection; the consent screen is the gate.
 */
export interface OriginConfig {
  /**
   * The operator's PINNED RP-ID. Never inferred from a URL or hostname.
   *
   * K = HKDF(PRF(credential, rpId)): a single PRF evaluation IS the wallet key, and PRF is scoped to
   * (credential, rpId). An origin on a subdomain (auth.example.com) has a hostname that is NOT the
   * rpId (example.com) — inferring one finds no passkey, and would derive a DIFFERENT WALLET.
   */
  rpId: string;
  /** This popup's own origin, e.g. "https://auth.example.com". */
  authOrigin: string;
  /** The operator-configured anchor chain (EVM-only). Defaults to Optimism (eip155:10). */
  anchorChainId?: ChainId;
  /** Operator branding surfaced in the popup (name, etc.). */
  branding?: { operatorName: string };
  /** Client-config passthrough for the popup. */
  managementUrl?: string;
  paymasterUrl?: string;
  feeToken?: string;
}

/**
 * Fail loud if the operator did not pin an rpId. K = HKDF(PRF(credential, rpId)); a single PRF
 * evaluation IS the wallet, and PRF is scoped to (credential, rpId). An unset — or worse, an
 * inferred-from-URL — rpId is a wallet-drain security defect, not a convenience gap, so the build
 * refuses to proceed without an explicit, non-empty value. NEVER derive this from a hostname.
 *
 * This survived the server's deletion deliberately: it now fires at build time rather than at
 * construction, but the defect it prevents is unchanged.
 */
export class MissingRpIdError extends Error {
  constructor() {
    super(
      "OriginConfig.rpId is required and must be a non-empty string. The rpId scopes the passkey " +
        "PRF that IS the wallet key — it must be pinned explicitly by the operator, never inferred " +
        'from a URL or hostname. Set config.rpId to your fixed, narrow RP-ID (e.g. "wallet.example.com").',
    );
    this.name = "MissingRpIdError";
  }
}

export function assertRpId(rpId: unknown): asserts rpId is string {
  if (typeof rpId !== "string" || rpId.trim() === "") throw new MissingRpIdError();
}
