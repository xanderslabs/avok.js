/**
 * mountAuthPopup — the plain-JS entry the developer drops into their hosted vault page, and the code
 * the hardened-page emitter inlines into the CSP-safe artifact.
 *
 * It wires the real passkey gesture (readAccount / signWith over withDiscoveredKeys) to the
 * framework-free ceremony driver + the plain-DOM view. The wallet key is reconstructed from the
 * passkey PRF here, used, and discarded; only the account or the signature crosses back to the opener.
 *
 * `authPopupDeps` exposes the non-view wiring so the React `<AuthPopup>` can drive the SAME gesture
 * with its own renderer — the money path has one implementation, not two.
 */
import type { Hex } from "viem";
import { WebAuthnPasskeyAdapter, withDiscoveredKeys } from "../wallet/index.js";
import { performSign } from "./sign/perform-sign.js";
import type { SignConsentRequest } from "./sign/consent.js";
import {
  runAuthPopup,
  runAuthRedirect,
  type AuthPopupConfig,
  type AuthPopupCeremonyDeps,
  type AuthPopupAccount,
} from "./ceremony.js";
import { decodeRequestUrl } from "../channel/redirect-protocol.js";
import { createDomView } from "./view-dom.js";

/** The gesture wiring (everything except the view). Used by mountAuthPopup with the DOM view, and by
 *  the React `<AuthPopup>` with a React view. */
export function authPopupDeps(config: AuthPopupConfig): Omit<AuthPopupCeremonyDeps, "view"> {
  // The operator's PINNED rpId, verbatim — deriving it from the origin's hostname is wrong whenever the
  // origin is a subdomain (auth.example.com) while the rpId is the apex (example.com): discover() would
  // find no passkey, and K = HKDF(PRF(credential, rpId)) would derive a DIFFERENT wallet.
  const passkey = new WebAuthnPasskeyAdapter({ rpName: config.operatorName, rpId: config.rpId });

  return {
    win: window as unknown as AuthPopupCeremonyDeps["win"],

    async readAccount(challenge: string): Promise<{ account: AuthPopupAccount; proof: Hex }> {
      return withDiscoveredKeys({ passkey }, async (keys, walletState) => {
        // Record WHICH passkey the user chose — it costs no extra prompt (it falls out of this gesture)
        // and lets later sign popups skip the account picker.
        const account: AuthPopupAccount = {
          evmAddress: walletState.evmAddress,
          credentialId: walletState.credentialId,
        };
        // The proof is signed INSIDE this gesture, so it costs the user nothing extra — the key is
        // already reconstructed and about to be discarded. What it buys is that the caller can verify
        // this address rather than trusting whatever delivered it.
        const proof = await keys.evm.signMessage({ message: challenge });
        return { account, proof };
      });
    },

    async signWith(request: SignConsentRequest, credentialId?: string): Promise<unknown> {
      // Constrain the assertion to the passkey this account was established with → straight to
      // biometrics, no picker. FALLBACK: if that credential is gone, fall back to an unconstrained
      // discover() rather than dead-ending the user (worst case they see the picker).
      const run = (cred?: string) =>
        withDiscoveredKeys({ passkey, ...(cred ? { credentialId: cred } : {}) }, async (keys, walletState) =>
          performSign(request, keys, walletState),
        );
      if (!credentialId) return run();
      try {
        return await run(credentialId);
      } catch {
        return run();
      }
    },
  };
}

/**
 * Mount the wallet sandbox into `root` (defaults to #root). Returns a disposer.
 *
 * ONE PAGE SERVES BOTH CLIENTS, and it decides which by looking at how it was opened rather than by
 * being configured. A browser popup arrives with an opener to talk to and an empty fragment; a native
 * in-app browser session arrives with the request IN the fragment and nobody to talk to. The operator
 * hosts one page and it works for both, because asking them to deploy two — or to guess a flag — is
 * how one of the two ends up untested and broken.
 *
 * Detection is on the REQUEST, not on the user agent. Sniffing for "am I in a WebView" is guesswork
 * that breaks on every new browser; the presence of a request in the fragment is a fact about this
 * navigation and cannot be wrong.
 */
export function mountAuthPopup(config: AuthPopupConfig, root?: HTMLElement): () => void {
  const el = root ?? document.getElementById("root");
  if (!el) throw new Error('mountAuthPopup: no root element (pass one, or add <div id="root"> to the page)');
  const view = createDomView(el);
  const deps = { ...authPopupDeps(config), view };

  // A request in the fragment means a redirect-driven session: there is no opener, and the answer
  // has to leave by navigation.
  if (decodeRequestUrl(window.location.href)) {
    return runAuthRedirect(deps as Parameters<typeof runAuthRedirect>[0]);
  }
  return runAuthPopup(deps);
}
