import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WebAuthnPasskeyAdapter, withDiscoveredKeys } from "@avokjs/core/wallet";
import { vaultForChain } from "./vault.js";
import { readConfig } from "./config.js";

// Shared-origin connect tunnel (USE-ONLY).
//   opener postMessages the request → ONE gesture (withDiscoveredKeys) reads the wallet
//   → postMessage({ kind:"authorize", account }) back to the opener's PINNED origin.
//   No create/registration.
//
// #8 DELETED THE OIDC HALF. This used to POST /authorize/challenge, sign a PKCE-bound SIWE message
// plus a domain-bound Solana proof-of-possession, POST /authorize/complete, and hand back an OIDC
// code for the opener to exchange for tokens. All of it existed to convince a SERVER to mint a
// credential. There is no server and no credential: what the opener needs is the user's ADDRESS,
// which is public. A hostile popup could only make a dapp DISPLAY a wrong address — it cannot sign,
// because every signature is a fresh passkey gesture here, against the real key. So those proofs
// proved something that does not need proving, and they are gone.
//
// The gesture is NOT gone, and is not ceremonial: it is what reads the wallet at all (K is derived
// from the passkey PRF), and it is the user's decision to connect.
//
// DEVICE-GATED: real passkey + cross-origin postMessage require a live browser.

type Account = { evmAddress: string; solanaAddress?: string; credentialId?: string };

async function readAccount(): Promise<Account> {
  const config = readConfig();
  // Use the operator's PINNED rpId verbatim. Deriving it from the origin's hostname is wrong whenever
  // the origin is mounted on a subdomain (auth.example.com) while the rpId is the apex (example.com):
  // discover() would find no passkey, and K = HKDF(PRF(credential, rpId)) would derive a DIFFERENT wallet.
  const passkey = new WebAuthnPasskeyAdapter({ rpName: config.operatorName, rpId: config.rpId });

  return withDiscoveredKeys({ passkey, vaultForChain }, async (_keys, walletState, meta) => {
    // Record WHICH passkey the user chose. It costs no extra prompt — it falls out of the gesture we
    // just performed. Without it, every later sign popup shows the account picker again. It used to
    // travel to the opener inside the access token's claims; now it travels in the account itself.
    const account: Account = { evmAddress: walletState.evmAddress };
    if (walletState.solanaAddress !== undefined) account.solanaAddress = walletState.solanaAddress;
    if (meta.credentialId !== undefined) account.credentialId = meta.credentialId;
    return account;
  });
}

function run(root: ReturnType<typeof createRoot>): void {
  let pending = false;

  window.addEventListener("message", (event: MessageEvent) => {
    // Only our direct opener; reject empty/opaque origins. There is no server-injected target any
    // more, so the ONLY origin we will ever reply to is the one that spoke to us first — learned
    // here, from the browser, and never re-derived from a param the page could influence.
    if (event.source !== window.opener) return;
    if (!event.origin || event.origin === "null") return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    if ((data as { kind?: unknown }).kind !== "authorize") return;
    // Idempotent: the opener sends eagerly AND again on our `ready`, so a duplicate can arrive.
    if (pending) return;
    pending = true;

    const replyOrigin = event.origin;
    readAccount()
      .then((account) => {
        // Reply in the channel's ChannelResult shape: { kind: "authorize"; account }. The opener
        // discriminates on `kind`.
        //
        // This once replied with a differently-discriminated message carrying a redirect URL —
        // wrong discriminant AND wrong payload — so the client dropped every reply (its `kind` check
        // saw undefined) and the popup hung until the 5-minute timeout. app-render.test.ts pins the
        // shape. Targeted at the pinned origin, never "*".
        window.opener?.postMessage({ kind: "authorize", account }, replyOrigin);
      })
      .catch((e: Error) => {
        root.render(<p style={{ font: "16px system-ui", padding: 24 }}>Sign-in failed: {e.message}</p>);
      });
  });

  // Tell the opener we are listening. Without this the request is LOST: the opener posts it in the
  // same task as window.open(), long before this document exists, and postMessage does not queue for
  // an unloaded document. (/authorize used to read its params from the URL and so never needed this;
  // with the OIDC params gone, the opener's message is now our ONLY input — and the only way we learn
  // which origin to reply to.)
  //
  // targetOrigin "*" is safe here and unavoidable: the payload is a bare {kind:"ready"} with no
  // secret, and we cannot yet name the opener's origin — we only learn it from its first message.
  // Every message we send that CARRIES anything is targeted at that pinned origin, never "*".
  window.opener?.postMessage({ kind: "ready" }, "*");
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <p style={{ font: "16px system-ui", padding: 24 }}>Signing you in…</p>
  </StrictMode>,
);
run(root);
