import type { Account, FullAvokClient } from "../index.js";

/** Transport that moves the opaque pairing codes between devices. The browser implementation is in
 *  `@avokjs/helpers/qr`; a React-Native app implements the same interface over its native
 *  camera. The driver below is transport-agnostic — it knows nothing about QR, DOM, or cameras. */
export interface PairingTransport {
  /** Present a code to the other device (e.g. render a QR). */
  showCode(code: string): void;
  /** Acquire a code from the other device (e.g. scan a QR). Rejects if acquisition is impossible
   *  (browser: CameraUnavailableError). Resolves as soon as one code is captured. */
  scanCode(): Promise<string>;
  /** Release any resources (camera, timers) and clear the display. Idempotent. */
  stop(): void;
}

export type ImportStep = "show-request" | "scan-ack" | "confirm-sas" | "show-wrap" | "done";
export type ExportStep = "scan-request" | "show-ack" | "confirm-sas" | "scan-wrap" | "done";

export interface CeremonyHandlers<Step> {
  onStep(step: Step): void;
  /** Surface the SAS to the user; resolve true if they confirm it matches, false to abort. */
  confirmSas(sas: string): Promise<boolean>;
}

/** The ENROLLER (the new device/domain) — wraps the SDK's `pairing.enroller`. It never receives the
 *  wallet key, so it is NOT logged in when the ceremony ends: it calls `continue()` afterwards, once
 *  the holder's write has landed. */
export interface ImportCtl {
  begin(): Promise<{ requestQr: string }>;
  receiveAck(ackQr: string): Promise<{ sas: string }>;
  /** Mint this origin's credential and hand back its wrapping key, sealed. */
  confirm(): Promise<{ wrapQr: string }>;
  reject(): void;
}

type CompleteResult = Awaited<ReturnType<FullAvokClient["enrollAccessSlot"]["viaPairing"]["holder"]["complete"]>>;

/** The HOLDER (the live wallet) — wraps the SDK's `pairing.holder`. This side scans the wrap, seals K
 *  under the enroller's wrapping key, and PAYS for the on-chain write. */
export interface ExportCtl {
  authorize(requestQr: string): Promise<{ ackQr: string; sas: string }>;
  /** Seals K under the enroller's wrapping key and writes the access slot on chain. The write IS the
   *  transaction: it lands, or the enrolment fails — there is no queued access slot. Derived from the SDK
   *  so this contract cannot drift from the real `complete()`; the driver discards the result. */
  confirm(wrapQr: string): Promise<CompleteResult>;
  reject(): void;
}

const SAS_REJECTED = "SAS did not match — pairing cancelled";

/** ENROLLER: show request → scan ack → confirm SAS → show wrap → done.
 *
 *  It returns nothing: the enroller is not logged in by the ceremony, because it was handed no key.
 *  The app calls `client.login()` once the holder's write has landed — one ordinary passkey prompt,
 *  and the price of the wallet key never touching the wire. */
export async function runImportCeremony(ctl: ImportCtl, t: PairingTransport, h: CeremonyHandlers<ImportStep>): Promise<void> {
  h.onStep("show-request");
  const { requestQr } = await ctl.begin();
  t.showCode(requestQr);

  h.onStep("scan-ack");
  const ackQr = await t.scanCode();
  const { sas } = await ctl.receiveAck(ackQr);

  h.onStep("confirm-sas");
  if (!(await h.confirmSas(sas))) {
    ctl.reject();
    t.stop();
    throw new Error(SAS_REJECTED);
  }

  h.onStep("show-wrap");
  const { wrapQr } = await ctl.confirm();
  t.showCode(wrapQr);

  h.onStep("done");
  // The wrap QR stays up for the holder to scan; the caller stops the transport when the user is done.
}

/** HOLDER: scan request → show ack → confirm SAS → scan wrap → done (writes the access slot, and pays). */
export async function runExportCeremony(ctl: ExportCtl, t: PairingTransport, h: CeremonyHandlers<ExportStep>): Promise<void> {
  h.onStep("scan-request");
  const requestQr = await t.scanCode();
  const { ackQr, sas } = await ctl.authorize(requestQr);

  h.onStep("show-ack");
  t.showCode(ackQr); // the ack carries the sealed wallet + chain the enroller needs to mint

  h.onStep("confirm-sas");
  if (!(await h.confirmSas(sas))) {
    ctl.reject();
    t.stop();
    throw new Error(SAS_REJECTED);
  }

  h.onStep("scan-wrap");
  const wrapQr = await t.scanCode();
  await ctl.confirm(wrapQr); // seals K under the enroller's wrapping key and writes the access slot

  t.stop();
  h.onStep("done");
}

// Re-export the client's pairing verb type so apps/RN can build controllers against the same shapes.
export type { Account } from "../index.js";
export type PairingVerbs = FullAvokClient["enrollAccessSlot"]["viaPairing"];
