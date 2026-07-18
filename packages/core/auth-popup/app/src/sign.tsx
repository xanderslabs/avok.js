import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { WebAuthnPasskeyAdapter, withDiscoveredKeys } from "@avokjs/core/wallet";
import { performSign } from "@avokjs/core/auth-popup";
import { decodeSignConsent, type SignConsentRequest } from "@avokjs/core/auth-popup";
import { formatConsentDisplay } from "@avokjs/core/auth-popup";
import { vaultForChain } from "./vault.js";
import { readConfig } from "./config.js";

// Shared-origin signing tunnel (the money path):
//   opener postMessages {kind:"sign", request, credentialId?} → decode IN THIS BUNDLE (NO gesture)
//   → show the consent → Approve: ONE passkey gesture, sign IN THE BROWSER → postMessage(result)
//   → Reject: postMessage({error:"user_rejected"}).
//
// Signing is ALWAYS device-side: `withDiscoveredKeys` reconstructs the wallet key from the passkey PRF
// here, in this popup, uses it, and discards it. The origin never sees it. (The old server-side
// `POST /sign` endpoint was deleted for that reason — but this popup was never rewired to sign
// locally, so Approve 404'd and shared-origin signing was dead until now.)
//
// DEVICE-GATED: the passkey gesture + cross-origin postMessage need a live browser. The op→signature
// logic itself is pure and unit-tested (src/sign/perform-sign.ts).

// `credentialId` replaces the old `sessionId`: the opener holds it (connect() returned it) and
// sends it so the assertion can be constrained to the right passkey. There is no session.
type SignData = { kind: "sign"; request: unknown; credentialId?: string };

function SignTunnel() {
  const config = readConfig();
  const AUTH_ORIGIN = config.authOrigin;
  const pending = useRef<{ data: SignData; replyOrigin: string } | null>(null);
  const pinnedOrigin = useRef<string | null>(null);
  const [consent, setConsent] = useState("Loading…");
  const [actions, setActions] = useState(false);
  // Decode failed: the request can never be approved, but the user must still be able to dismiss it
  // — and the opener must get a real rejection rather than waiting out its 5-minute timeout.
  const [rejectOnly, setRejectOnly] = useState(false);
  // A DEAD SESSION is not a user decision. Reporting it as "user_rejected" would leave the app
  // logged in against a session the origin has already forgotten — the user would be bounced out of
  // every signature with no way to understand why. Tell the opener the truth and it signs them out.
  const [status, setStatus] = useState("");
  const [reqOrigin, setReqOrigin] = useState("");
  // The passkey this account was established with. With it, the assertion is constrained and the
  // browser goes straight to biometrics; without it the user is asked to pick a passkey on EVERY
  // signature.
  //
  // It used to arrive from POST /sign/consent, which read it off the access token's claims. There
  // is no token now (#8), so the OPENER sends it: the app got it from connect() and holds it in its
  // SharedAccount, which always carried `credentialId?`. Same value, one less round-trip.
  const [credentialId, setCredentialId] = useState<string | undefined>(undefined);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only accept messages from our direct opener; reject empty/opaque origins.
      if (event.source !== window.opener) return;
      if (!event.origin || event.origin === "null") return;
      // Pin the opener origin on the first accepted message; drop any later origin-switch.
      if (pinnedOrigin.current === null) pinnedOrigin.current = event.origin;
      else if (event.origin !== pinnedOrigin.current) return;
      const data = event.data as SignData | undefined;
      if (!data || data.kind !== "sign") return;
      // Idempotent: the opener sends the request eagerly AND again on our `ready` (see below), so a
      // duplicate can arrive. Take the first; re-entering would fire a second /sign/consent.
      if (pending.current) return;
      pending.current = { data, replyOrigin: pinnedOrigin.current };
      setReqOrigin(pinnedOrigin.current);
      // NEVER enable Approve unless we have actually decoded and DISPLAYED the request.
      //
      // This used to POST the request to the origin to be decoded, and once rendered a
      // `{"error":"invalid_token"}` body as the "consent summary" while still offering Approve —
      // and Approve WORKED, because signing is device-side and never consults the origin. The user
      // would have signed a transaction whose contents this popup failed to decode and never showed
      // them. Blind signing is precisely what a consent screen exists to prevent, so a failed decode
      // stays terminal: explain it, and offer only Reject.
      //
      // The decode is now IN THIS BUNDLE. It was always a stateless pure function — the endpoint
      // existed only to gate it with a token against "unauthenticated probing", and there is no
      // token. Nothing to await, and no network call left in this popup at all.
      try {
        const display = formatConsentDisplay(decodeSignConsent(data.request as SignConsentRequest));
        if (!Array.isArray(display) || display.length === 0) {
          throw new Error("No summary could be produced for this request.");
        }
        setCredentialId(data.credentialId);
        setConsent(display.join("\n"));
        setActions(true); // only now — the user can see what they are approving
      } catch (err) {
        setConsent(`Can't show you this request, so it can't be approved.\n\n${(err as Error).message}`);
        setActions(false);
        setRejectOnly(true);
      }
    }
    window.addEventListener("message", onMessage);

    // Tell the opener we are listening. Without this the request is LOST: the opener posts it in the
    // same task as window.open(), long before this document exists, and postMessage does not queue
    // for an unloaded document — so this popup hung on "Loading…" and shared-origin signing was dead.
    //
    // targetOrigin "*" is safe here and unavoidable: the payload is a bare {kind:"ready"} with no
    // secret, and we cannot yet name the opener's origin — we only learn it from its first message
    // (that is what pins `pinnedOrigin`). Every message we send that CARRIES anything (the signature,
    // the rejection) is targeted at that pinned origin, never "*".
    window.opener?.postMessage({ kind: "ready" }, "*");

    return () => window.removeEventListener("message", onMessage);
  }, []);

  function approve() {
    const p = pending.current;
    if (!p) return;
    setStatus("Waiting for passkey…");
    setActions(false);

    // ONE gesture: discover the credential, derive the wallet key from its PRF, sign, discard. The
    // rpId is the operator's PINNED value — never inferred from the URL (that would derive a
    // DIFFERENT wallet, since K = HKDF(PRF(credential, rpId))).
    const passkey = new WebAuthnPasskeyAdapter({ rpName: config.operatorName, rpId: config.rpId });

    // Constrain the assertion to the passkey this session was established with → straight to
    // biometrics, no account picker. Exactly what own-origin does: it remembers the credential it logged
    // in with and binds every later signature to it.
    //
    // FALLBACK: if that credential is gone (removed from the authenticator, or synced away), fall
    // back to an unconstrained discover() rather than dead-ending the user with a wallet they cannot
    // open. Worst case they see the picker — the old behaviour — instead of a wall.
    const sign = async () => {
      const run = (credential?: string) =>
        withDiscoveredKeys(
          { passkey, vaultForChain, ...(credential ? { credentialId: credential } : {}) },
          async (keys, walletState) =>
            performSign(p.data.request as SignConsentRequest, keys, walletState, config.rpId),
        );

      if (!credentialId) return run();
      try {
        return await run(credentialId);
      } catch {
        return run(); // the pinned credential is unusable — let the user choose
      }
    };

    void sign()
      .then((result) => {
        window.opener?.postMessage({ kind: "sign", result }, p.replyOrigin || AUTH_ORIGIN);
        window.close();
      })
      .catch((err: Error) => {
        setStatus("Error: " + err.message);
        setActions(true);
      });
  }

  function reject() {
    const p = pending.current;
    if (!p) return;
    // Reject is the only refusal left: there is no session to expire (#8).
    const error = "user_rejected";
    window.opener?.postMessage({ kind: "sign", result: { error } }, p.replyOrigin || AUTH_ORIGIN);
    window.close();
  }

  return (
    <div style={{ font: "14px system-ui", padding: 20, maxWidth: 380, margin: "0 auto" }}>
      <div style={{ fontSize: 12, color: "#888" }}>{reqOrigin}</div>
      <div style={{ fontWeight: 600, margin: "8px 0" }}>Signing request</div>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12, background: "#f4f4f5", padding: 12, borderRadius: 8 }}>{consent}</pre>
      {(actions || rejectOnly) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={reject}>{rejectOnly ? "Close" : "Reject"}</button>
          {actions && <button onClick={approve}>Approve</button>}
        </div>
      )}
      {status && <div style={{ fontSize: 12, marginTop: 8 }}>{status}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SignTunnel />
  </StrictMode>,
);
