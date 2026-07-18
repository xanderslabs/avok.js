/**
 * The framework-free auth-popup ceremony driver.
 *
 * This is the wallet-sandbox popup's brain, with the DOM and React removed. It owns the postMessage
 * protocol and the authorize/sign orchestration that used to live inline in the two React app entries
 * (app/src/authorize.tsx + sign.tsx). Rendering is behind the `AuthPopupView` seam, so both the
 * plain-DOM `mountAuthPopup` (which the emitter inlines) and the React `<AuthPopup>` drive the SAME
 * protocol, and this file is fully unit-testable with a fake view + fake window.
 *
 * ONE PAGE, TWO REQUESTS. The popup posts `ready`, then services whatever the opener asks from the
 * same passkey/sandbox setup:
 *   { kind:"authorize" } → ONE gesture reads the wallet → reply { kind:"authorize", account }. No consent.
 *   { kind:"sign", request, credentialId? } → decode IN-BUNDLE (no gesture) → show consent →
 *     Approve: ONE gesture, sign IN THE BROWSER → reply { kind:"sign", result };
 *     Reject / undecodable: reply { kind:"sign", result:{ error:"user_rejected" } }.
 *
 * The wallet key never leaves: the gesture (readAccount / signWith) reconstructs K from the passkey PRF
 * here, uses it, and discards it. Only the account (public) or the signature crosses back.
 *
 * DEVICE-GATED: the real gesture + cross-origin postMessage need a live browser. The gesture is
 * injected (readAccount / signWith) so the protocol logic here is pure.
 */
import { decodeSignConsent, type SignConsentRequest } from "./sign/consent.js";
import { formatConsentDisplay } from "./sign/consent-display.js";

/** The operator config baked into the page, mirrors app/branding.ts's AppConfig. */
export interface AuthPopupConfig {
  operatorName: string;
  authOrigin: string;
  /** The operator's PINNED rpId. Used verbatim by the gesture — NEVER inferred from the URL. An
   *  origin on a subdomain (auth.example.com) has a hostname that is not the rpId (example.com);
   *  inferring finds no passkey, and since K = HKDF(PRF(credential, rpId)) it derives a DIFFERENT
   *  WALLET. */
  rpId: string;
  defaultChainId: number;
  managementUrl?: string;
  paymasterUrl?: string;
  feeToken?: string;
}

/** The account the authorize flow hands back to the opener. `credentialId` lets later sign popups
 *  constrain the assertion to the right passkey (straight to biometrics, no picker). */
export interface AuthPopupAccount {
  evmAddress: string;
  solanaAddress?: string;
  credentialId?: string;
}

/**
 * Everything user-visible, behind one seam. The driver never touches the DOM; a renderer implements
 * this. `showConsent` resolves true=approve / false=reject and is the ONLY gate to signing.
 */
export interface AuthPopupView {
  /** Authorize flow is running (a "Signing you in…" state). */
  connecting(): void;
  /**
   * Show the decoded request and wait for the user's decision. Resolves true to approve, false to
   * reject. `rejectOnly` renders a dismiss-only screen (used when decode failed — the request can
   * never be approved, but the user must still be able to dismiss it) and resolves false. `error`
   * surfaces a failed signing attempt so the user can retry Approve.
   */
  showConsent(lines: string[], opts?: { error?: string; rejectOnly?: boolean }): Promise<boolean>;
  /** The passkey gesture is pending. */
  waitingForPasskey(): void;
  /** A terminal error with no reply path (the authorize gesture failed). */
  failure(message: string): void;
}

interface OpenerLike {
  postMessage(data: unknown, targetOrigin: string): void;
}
interface WindowLike {
  opener: OpenerLike | null;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  /** Optional: closed after a sign reply (mirrors the old sign.tsx). Tests omit it. */
  close?(): void;
}

export interface AuthPopupCeremonyDeps {
  view: AuthPopupView;
  /** ONE gesture: reconstruct the wallet from the passkey PRF and return the (public) account. */
  readAccount(): Promise<AuthPopupAccount>;
  /** ONE gesture: reconstruct the wallet, sign the request, discard the key. Returns performSign's
   *  result. `credentialId` (from the sign message) constrains the assertion, with a fallback to an
   *  unconstrained discover() handled inside the implementation. */
  signWith(request: SignConsentRequest, credentialId?: string): Promise<unknown>;
  win: WindowLike;
}

type SignMessage = { kind: "sign"; request: unknown; credentialId?: string };

/**
 * Attach the message listener and post `ready`. Returns a disposer that removes the listener.
 *
 * Only our direct opener is trusted, and only the origin it FIRST spoke from — learned here, from the
 * browser, and never re-derived from anything the page could influence. The opener posts its request
 * eagerly (in the same task as window.open, before this document exists — postMessage does not queue
 * for an unloaded document) AND again on our `ready`, so a duplicate can arrive: we take the first and
 * ignore the rest (`pending`).
 */
export function runAuthPopup(deps: AuthPopupCeremonyDeps): () => void {
  const { view, win } = deps;
  let pinnedOrigin: string | null = null;
  let pending = false;

  function handler(event: MessageEvent): void {
    if (event.source !== win.opener) return;
    if (!event.origin || event.origin === "null") return;
    // Pin the opener origin on the first accepted message; drop any later origin switch.
    if (pinnedOrigin === null) pinnedOrigin = event.origin;
    else if (event.origin !== pinnedOrigin) return;

    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const kind = (data as { kind?: unknown }).kind;
    if (kind !== "authorize" && kind !== "sign") return;

    if (pending) return;
    pending = true;
    const replyOrigin = pinnedOrigin;

    if (kind === "authorize") {
      view.connecting();
      deps
        .readAccount()
        .then((account) => {
          // Reply in the channel's ChannelResult shape. Targeted at the pinned origin, never "*".
          win.opener?.postMessage({ kind: "authorize", account }, replyOrigin);
        })
        .catch((e: Error) => view.failure(e.message));
      return;
    }

    void runSign(data as SignMessage, replyOrigin);
  }

  async function runSign(msg: SignMessage, replyOrigin: string): Promise<void> {
    // Decode IN THIS BUNDLE (it was always a stateless pure function; the old token-gated endpoint is
    // gone). NEVER enable Approve unless the request actually decoded and displayed — a failed decode
    // stays terminal (reject-only), because blind signing is exactly what a consent screen prevents.
    let lines: string[];
    let rejectOnly = false;
    try {
      lines = formatConsentDisplay(decodeSignConsent(msg.request as SignConsentRequest));
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error("No summary could be produced for this request.");
      }
    } catch (err) {
      lines = ["Can't show you this request, so it can't be approved.", (err as Error).message];
      rejectOnly = true;
    }

    let error: string | undefined;
    for (;;) {
      const approved = await view.showConsent(lines, { error, rejectOnly });
      if (!approved) {
        // The only refusal left is user_rejected — there is no session to expire (#8).
        win.opener?.postMessage({ kind: "sign", result: { error: "user_rejected" } }, replyOrigin);
        win.close?.();
        return;
      }
      view.waitingForPasskey();
      try {
        const result = await deps.signWith(msg.request as SignConsentRequest, msg.credentialId);
        win.opener?.postMessage({ kind: "sign", result }, replyOrigin);
        win.close?.();
        return;
      } catch (err) {
        // Signing failed (e.g. the gesture was dismissed). Re-show the consent with the error so the
        // user can retry Approve or Reject — matching the old sign.tsx, which re-enabled the actions.
        error = (err as Error).message;
      }
    }
  }

  win.addEventListener("message", handler);

  // Tell the opener we are listening. Without this the request is LOST (see above). targetOrigin "*"
  // is safe and unavoidable here: the payload is a bare { kind:"ready" } with no secret, and we cannot
  // yet name the opener's origin — we only learn it from its first message. Every message that CARRIES
  // anything (the account, the signature, the rejection) is targeted at the pinned origin, never "*".
  win.opener?.postMessage({ kind: "ready" }, "*");

  return () => win.removeEventListener("message", handler);
}
