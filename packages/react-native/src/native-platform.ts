/**
 * Native platform trio builder.
 *
 * Wraps the `react-native-passkey`-shaped module (injected by the caller) in
 * Avok's PasskeyAdapter contract via `createReactNativePasskeyAdapter` from
 * `@avokjs/core/wallet`.
 *
 * No hard dependency on react-native or expo here — the passkey module is
 * injected so this file is importable in any environment.

 */
import { createReactNativePasskeyAdapter } from "@avokjs/core/wallet";
import type { ReactNativePasskeyLike, PasskeyAdapter } from "@avokjs/core/wallet";

/**
 * Wraps an injected `react-native-passkey`-shaped module in Avok's PasskeyAdapter.
 *
 * @param passkeyModule — e.g. `import Passkey from "react-native-passkey"` or a fake.
 * @param rpId — the relying-party ID (your app's domain, e.g. "app.avok.fi").
 * @param operatorName — optional cosmetic friendly name → WebAuthn `rp.name` (the OS prompt).
 *   Defaults to the rpId domain when unset. Display only — never affects the rpId.
 */
export function buildNativePasskeyAdapter(
  passkeyModule: ReactNativePasskeyLike,
  rpId: string,
  operatorName?: string,
): PasskeyAdapter {
  return createReactNativePasskeyAdapter(passkeyModule, { rpId, rpName: operatorName ?? rpId });
}
