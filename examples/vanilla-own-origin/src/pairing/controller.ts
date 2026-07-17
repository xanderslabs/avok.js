/**
 * Framework-free enrolment controllers for the web demo.
 *
 * They wrap the SDK's `pairing` verbs and make the SAS gate explicit: the verbs that assert
 * `sasConfirmed: true` are reachable ONLY via `confirm()`, and only from the `awaiting-confirm`
 * state. `reject()` abandons the ephemeral session and can never assert confirmation. Keeping this
 * logic out of the component lets the gate be unit-tested without a DOM (see the reject path).
 *
 * ONE CEREMONY, THREE CODES — and the wallet key never travels:
 *   enroller.begin()      → request QR   (shown by the device getting a passkey)
 *   holder.authorize(qr)  → ack QR + SAS (the ack carries the sealed wallet + chain)
 *   enroller.confirm()    → wrap QR      (mints the credential; sends its wrapping key, never K)
 *   holder.confirm(wrapQr)→ writes the access slot on chain, and PAYS for it
 *   ...then the new device calls continue() to log in, like any other passkey.
 */
import type { FullAvokClient } from "@avokjs/vanilla";

type Pairing = FullAvokClient["enrollAccessSlot"]["viaPairing"];
/** Derived from the SDK so the demo cannot drift from the real `complete()` shape. */
type CompleteResult = Awaited<ReturnType<Pairing["holder"]["complete"]>>;
export type PairStatus = "idle" | "awaiting-confirm" | "done" | "rejected";

/** The HOLDER (the live wallet): authorize the new device, then — after the SAS matches — scan its
 *  wrap code and write the access slot. This side pays; the enroller needs no chain access at all. */
export interface AuthorizeController {
  readonly status: PairStatus;
  /** Consume the new device's request QR → the ack QR to hand back, plus the SAS to compare. */
  authorize(requestQr: string): Promise<{ ackQr: string; sas: string }>;
  /** User confirmed the SAS → scan the enroller's wrap QR, seal K under its wrapping key, and write
   *  the access slot on chain. Asserts `sasConfirmed: true`.
   *
   *  The write IS the transaction: it lands, or the enrolment fails. Affordability is asserted before
   *  any credential is minted, so there is no queued access slot and no orphaned credential to reconcile. */
  confirm(wrapQr: string): Promise<CompleteResult>;
  /** User said the codes did NOT match → abandon. Never writes. */
  reject(): void;
}

export function createAuthorizeController(pairing: Pairing): AuthorizeController {
  let status: PairStatus = "idle";
  return {
    get status() {
      return status;
    },
    async authorize(requestQr: string) {
      const { qr, sas } = await pairing.holder.authorize({ qr: requestQr });
      status = "awaiting-confirm";
      return { ackQr: qr, sas };
    },
    async confirm(wrapQr: string) {
      if (status !== "awaiting-confirm") {
        throw new Error("confirm() is only valid after authorize() and before reject()");
      }
      const r = await pairing.holder.complete({ qr: wrapQr, sasConfirmed: true });
      status = "done";
      return r;
    },
    reject() {
      status = "rejected";
    },
  };
}

/** The ENROLLER (the new device or domain): begin → receive ack →, after the SAS matches, mint this
 *  origin's credential and hand back its wrapping key. It never receives the wallet key, so it is NOT
 *  logged in when the ceremony ends: it calls `continue()` once the holder's write has landed. */
export interface SetupController {
  readonly status: PairStatus;
  /** Start → the request QR to show the existing device. */
  begin(): Promise<{ requestQr: string }>;
  /** Consume the holder's ack QR (which carries the sealed wallet + chain) → the SAS to compare. */
  receiveAck(ackQr: string): Promise<{ sas: string }>;
  /** User confirmed the SAS → mint the credential and return the wrap QR for the holder to scan.
   *  Asserts `sasConfirmed: true`. */
  confirm(): Promise<{ wrapQr: string }>;
  /** User said the codes did NOT match → abandon. Never mints a credential. */
  reject(): void;
}

export function createSetupController(pairing: Pairing): SetupController {
  let status: PairStatus = "idle";
  return {
    get status() {
      return status;
    },
    async begin() {
      const { qr } = await pairing.enroller.begin();
      return { requestQr: qr };
    },
    async receiveAck(ackQr: string) {
      const { sas } = await pairing.enroller.receiveAck(ackQr);
      status = "awaiting-confirm";
      return { sas };
    },
    async confirm() {
      if (status !== "awaiting-confirm") {
        throw new Error("confirm() is only valid after receiveAck() and before reject()");
      }
      const { qr } = await pairing.enroller.enroll({ sasConfirmed: true });
      status = "done";
      return { wrapQr: qr };
    },
    reject() {
      status = "rejected";
    },
  };
}
