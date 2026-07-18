import { WebAuthnPasskeyAdapter } from "../wallet/index.js";
import type { PasskeyAdapter } from "../wallet/index.js";

/**
 * Builds a WebAuthnPasskeyAdapter for the own-origin connection path.
 * The rpId is passed so WebAuthn ceremonies are scoped to the app's origin.
 * The optional operatorName becomes the WebAuthn `rp.name` (the "Sign in to …" the OS shows);
 * it is cosmetic and defaults to the rpId domain when unset. It never affects the rpId.
 */
export function buildWebPasskeyAdapter(rpId: string, operatorName?: string): PasskeyAdapter {
  return new WebAuthnPasskeyAdapter({ rpId, rpName: operatorName ?? rpId });
}
