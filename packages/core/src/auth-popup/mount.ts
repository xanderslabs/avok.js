/**
 * mountAuthPopup — the plain-JS entry the developer drops into their hosted auth page, and the code
 * the hardened-page emitter inlines into the CSP-safe artifact.
 *
 * It wires the real passkey gesture (readAccount / signWith over withDiscoveredKeys, exactly as the
 * old app/src/{authorize,sign}.tsx did) to the framework-free ceremony driver + the plain-DOM view.
 * The wallet key is reconstructed from the passkey PRF here, used, and discarded; only the account or
 * the signature crosses back to the opener.
 *
 * `authPopupDeps` exposes the non-view wiring so the React `<AuthPopup>` can drive the SAME gesture
 * with its own renderer — the money path has one implementation, not two.
 */
import {
  WebAuthnPasskeyAdapter,
  withDiscoveredKeys,
  vaultForChainFromRegistry,
  type VaultReader,
} from "../wallet/index.js";
import { getChainProfile } from "@avokjs/contracts";
import { performSign } from "./sign/perform-sign.js";
import type { SignConsentRequest } from "./sign/consent.js";
import { runAuthPopup, type AuthPopupConfig, type AuthPopupCeremonyDeps, type AuthPopupAccount } from "./ceremony.js";
import { createDomView } from "./view-dom.js";

/**
 * A secondary credential's access-slot blob lives on the chain recorded in its user-handle marker.
 * Build a read-only vault for THAT chain from the registry RPC. A PRIMARY never calls this. An unknown
 * marker chain fails loud rather than querying the wrong chain and reporting a good wallet as "not
 * found". Shared by both request kinds so they resolve blobs identically. (Ported from app/src/vault.ts.)
 */
function vaultForChain(chainId: number): VaultReader {
  if (!getChainProfile(chainId)) {
    throw new Error(`No RPC for anchor chain ${chainId} — cannot reach this device's access-slot blob.`);
  }
  return vaultForChainFromRegistry(chainId);
}

/** The gesture wiring (everything except the view). Used by mountAuthPopup with the DOM view, and by
 *  the React `<AuthPopup>` with a React view. */
export function authPopupDeps(config: AuthPopupConfig): Omit<AuthPopupCeremonyDeps, "view"> {
  // The operator's PINNED rpId, verbatim — deriving it from the origin's hostname is wrong whenever the
  // origin is a subdomain (auth.example.com) while the rpId is the apex (example.com): discover() would
  // find no passkey, and K = HKDF(PRF(credential, rpId)) would derive a DIFFERENT wallet.
  const passkey = new WebAuthnPasskeyAdapter({ rpName: config.operatorName, rpId: config.rpId });

  return {
    win: window as unknown as AuthPopupCeremonyDeps["win"],

    async readAccount(): Promise<AuthPopupAccount> {
      return withDiscoveredKeys({ passkey, vaultForChain }, async (_keys, walletState, meta) => {
        // Record WHICH passkey the user chose — it costs no extra prompt (it falls out of this gesture)
        // and lets later sign popups skip the account picker.
        const account: AuthPopupAccount = { evmAddress: walletState.evmAddress };
        if (walletState.solanaAddress !== undefined) account.solanaAddress = walletState.solanaAddress;
        if (meta.credentialId !== undefined) account.credentialId = meta.credentialId;
        return account;
      });
    },

    async signWith(request: SignConsentRequest, credentialId?: string): Promise<unknown> {
      // Constrain the assertion to the passkey this account was established with → straight to
      // biometrics, no picker. FALLBACK: if that credential is gone, fall back to an unconstrained
      // discover() rather than dead-ending the user (worst case they see the picker).
      const run = (cred?: string) =>
        withDiscoveredKeys(
          { passkey, vaultForChain, ...(cred ? { credentialId: cred } : {}) },
          async (keys, walletState) => performSign(request, keys, walletState, config.rpId),
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

/** Mount the wallet-sandbox popup into `root` (defaults to #root). Returns a disposer. */
export function mountAuthPopup(config: AuthPopupConfig, root?: HTMLElement): () => void {
  const el = root ?? document.getElementById("root");
  if (!el) throw new Error('mountAuthPopup: no root element (pass one, or add <div id="root"> to the page)');
  const view = createDomView(el);
  return runAuthPopup({ ...authPopupDeps(config), view });
}
