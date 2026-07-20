import type { FullAvokClient } from "../index.js";

/** Thrown by a transport when the camera can't be acquired (permission denied or no camera). The app
 *  renders a retry state; the ceremony hook narrows on it to offer "camera blocked → retry". Defined
 *  here, with the transport contract (DOM-free), so BOTH the browser transport (`@avokjs/core/qr`) and
 *  a React-Native transport throw the SAME class the hook checks with `instanceof`. */
export class CameraUnavailableError extends Error {
  constructor() {
    super("Camera unavailable or permission denied");
    this.name = "CameraUnavailableError";
  }
}

/** Thrown when the enrolment window cannot be opened — the browser blocked the popup. Sits beside
 *  CameraUnavailableError, and for the same reason: it is the window transport's equivalent failure,
 *  it is RECOVERABLE (the user allows popups, or clicks again from a real gesture), and the ceremony
 *  hooks narrow on it to offer a retry instead of surfacing a dead end. Popup blocking is not an edge
 *  case — a browser blocks any window.open not traceable to a user gesture, which is exactly what
 *  happens when an app tries to start enrolment from an effect rather than a click. */
export class PopupBlockedError extends Error {
  constructor() {
    super("Enrolment window blocked — open it from a direct user gesture, or allow popups for this site");
    this.name = "PopupBlockedError";
  }
}

/** Transport that moves the opaque pairing codes between devices. The browser implementation is in
 *  `@avokjs/core/qr`; a React-Native app implements the same interface over its native camera. The
 *  driver below is transport-agnostic — it knows nothing about QR, DOM, or cameras. */
export interface PairingTransport {
  /** Present a code to the other device (e.g. render a QR). */
  showCode(code: string): void;
  /** Acquire a code from the other device (e.g. scan a QR). Rejects if acquisition is impossible
   *  (browser: CameraUnavailableError). Resolves as soon as one code is captured. */
  scanCode(): Promise<string>;
  /** Release any resources (camera, timers) and clear the display. Idempotent. */
  stop(): void;
}

// Two codes, so two transport steps per side instead of three. The SAS step stays: the digits are
// what make the reduction safe, not what the reduction removed.
//
// Named for INTENT, not for mechanism. "show"/"scan" describe a camera, and this ceremony also runs
// over postMessage, where nothing is shown and nothing is scanned — a step called `show-offer` would
// be a lie in the transport that needs no QR at all. send/await are true in both.
export type ImportStep = "await-invite" | "send-wrap" | "confirm-sas" | "done";
export type ExportStep = "send-invite" | "await-wrap" | "confirm-sas" | "done";

export interface CeremonyHandlers<Step> {
  onStep(step: Step): void;
  /** Surface the SAS to the user; resolve true if they confirm it matches, false to abort. */
  confirmSas(sas: string): Promise<boolean>;
}

/** The ENROLLER (the new device/domain) — wraps the SDK's `pairing.enroller`. It never receives the
 *  wallet key, so it is NOT logged in when the ceremony ends: it calls `continue()` afterwards, once
 *  the holder's write has landed. */
export interface ImportCtl {
  /** MINTS A PASSKEY, then seals its wrapping key and answers — returning the SAS for the user to
   *  compare. One call, because the session agreement now rides the same two codes that carry the
   *  payload. The name is deliberate: a credential comes into existence here. */
  mintAndWrap(inviteQr: string): Promise<{ wrapQr: string; sas: string }>;
  reject(): void;
}

type CompleteResult = Awaited<ReturnType<FullAvokClient["enrollAccessSlot"]["viaPairing"]["holder"]["complete"]>>;

/** The HOLDER (the live wallet) — wraps the SDK's `pairing.holder`. This side scans the wrap, seals K
 *  under the enroller's wrapping key, and PAYS for the on-chain write. */
export interface ExportCtl {
  /** Publish the invite: this wallet and its anchor chain. No SAS yet — the digits commit to both
   *  public keys, and the enroller's has not arrived. */
  invite(): Promise<{ inviteQr: string }>;
  /** Decrypt the wrap and return the SAS. The wrapping key stays behind a gate until `confirm`. */
  receiveWrap(wrapQr: string): Promise<{ sas: string }>;
  /** Seals K under the enroller's wrapping key and writes the access slot on chain. The write IS the
   *  transaction: it lands, or the enrolment fails — there is no queued access slot. Derived from the SDK
   *  so this contract cannot drift from the real `complete()`; the driver discards the result. */
  confirm(): Promise<CompleteResult>;
  reject(): void;
}

const SAS_REJECTED = "SAS did not match — pairing cancelled";

/** ENROLLER: await invite → send wrap → confirm SAS → done.
 *
 *  It returns nothing: the enroller is not logged in by the ceremony, because it was handed no key.
 *  The app calls `client.login()` once the holder's write has landed — one ordinary passkey prompt,
 *  and the price of the wallet key never touching the wire. */
export async function runImportCeremony(
  ctl: ImportCtl,
  t: PairingTransport,
  h: CeremonyHandlers<ImportStep>,
): Promise<void> {
  h.onStep("await-invite");
  const inviteQr = await t.scanCode();

  // Minting the credential, sealing W, and sending it all happen HERE — before the user has compared
  // anything. That is the reduction: W travels early because W alone is worthless. It becomes a key
  // to this wallet only once the holder seals K under it and publishes the blob, and the holder does
  // that only after the digits match.
  h.onStep("send-wrap");
  const { wrapQr, sas } = await ctl.mintAndWrap(inviteQr);
  t.showCode(wrapQr);

  h.onStep("confirm-sas");
  if (!(await h.confirmSas(sas))) {
    // ON MISMATCH THIS CREDENTIAL IS BURNED. A retry must mint a fresh one: W is scoped to
    // (address, slotId) and slotId derives from the credential id, so reusing it would make an
    // intercepted copy of W live the moment a later attempt published a blob.
    ctl.reject();
    t.stop();
    throw new Error(SAS_REJECTED);
  }

  h.onStep("done");
  // The holder writes the slot. This side is NOT logged in by the ceremony — it was handed no key —
  // so the app calls client.login() once that write has landed.
}

/** HOLDER: send invite → await wrap → confirm SAS → done (writes the access slot, and pays). */
export async function runExportCeremony(
  ctl: ExportCtl,
  t: PairingTransport,
  h: CeremonyHandlers<ExportStep>,
): Promise<void> {
  h.onStep("send-invite");
  const { inviteQr } = await ctl.invite();
  t.showCode(inviteQr);

  h.onStep("await-wrap");
  const wrapQr = await t.scanCode();
  const { sas } = await ctl.receiveWrap(wrapQr); // decrypts; the wrapping key stays gated

  h.onStep("confirm-sas");
  if (!(await h.confirmSas(sas))) {
    ctl.reject();
    t.stop();
    throw new Error(SAS_REJECTED);
  }

  // Only now does the wrapping key become reachable, and only now is the blob published — which is
  // what gives an intercepted W any power at all.
  await ctl.confirm();

  t.stop();
  h.onStep("done");
}

// Re-export the client's pairing verb type so apps/RN can build controllers against the same shapes.
export type { Account } from "../index.js";
export type PairingVerbs = FullAvokClient["enrollAccessSlot"]["viaPairing"];
