/**
 * usePairingCeremony — the headless device-pairing state machine.
 *
 * This is the reusable core extracted from the demos' 350-line PairDevice component: the three-round
 * QR handshake (driven by @avokjs/core/helpers' runImport/ExportCeremony), the tap-gating of each scan
 * (a device cannot detect that the other one scanned its QR), the camera-blocked retry loop, the SAS
 * confirmation gate, and the enroller-logs-in-at-the-end rule. It renders nothing — a component (or the
 * shipped <PairDevice>) draws the phases over the returned state + refs.
 *
 * ONE CEREMONY, THREE CODES — and the wallet key never travels:
 *   enroller.begin()       → request QR   (shown by the device getting a passkey)
 *   holder.authorize(qr)   → ack QR + SAS (the ack carries the sealed wallet + chain)
 *   enroller.confirm()     → wrap QR      (mints the credential; sends its wrapping key, never K)
 *   holder.confirm(wrapQr) → writes the access slot on chain, and PAYS for it
 *   ...then the new device (enroller) calls login() to log in, like any other passkey — `finish()`.
 */
import { useEffect, useRef, useState } from "react";
import { runImportCeremony, runExportCeremony, type PairingTransport, type PairingVerbs } from "@avokjs/core/helpers";
import { createBrowserQrTransport, CameraUnavailableError } from "@avokjs/core/qr";
import { useSelfCustody } from "./hooks.js";

export type PairPhase =
  | "loading"
  | "show"
  | "prompt-scan"
  | "scanning"
  | "working"
  | "camera-error"
  | "sas"
  | "done"
  | "rejected";

export interface PairingCeremony {
  phase: PairPhase;
  step: string;
  sas: string;
  error: string | null;
  /** The enroller (import) ends holding its wrap code up for the holder to scan; once the holder has
   *  scanned it, the user taps to finish → login(). True only in that terminal state. */
  canFinish: boolean;
  /** Advance a scan that is gated behind a user tap ("open camera" / "scan their reply"). */
  triggerScan(): void;
  /** Retry after the camera was blocked/absent. */
  retryCamera(): void;
  /** Resolve the SAS gate: true if the codes match on both devices, false to abort. */
  confirmSas(matches: boolean): void;
  /** Finish the enroller side: log in against the access slot the holder just wrote. */
  finish(): Promise<void>;
  qrRef: React.RefObject<HTMLDivElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

// ── The SAS-gated controllers (framework-free; wrap the client's pairing verbs) ──────────────────
// Kept here (not in the component) so the gate — the verbs that assert sasConfirmed:true are reachable
// ONLY via confirm(), and only after the handshake — stays out of the render path.

function setupController(pairing: PairingVerbs) {
  let ok = false;
  return {
    async begin() {
      const { qr } = await pairing.enroller.begin();
      return { requestQr: qr };
    },
    async receiveAck(ackQr: string) {
      const { sas } = await pairing.enroller.receiveAck(ackQr);
      ok = true;
      return { sas };
    },
    async confirm() {
      if (!ok) throw new Error("confirm() is only valid after receiveAck()");
      const { qr } = await pairing.enroller.enroll({ sasConfirmed: true });
      return { wrapQr: qr };
    },
    reject() {},
  };
}

function authorizeController(pairing: PairingVerbs) {
  let ok = false;
  return {
    async authorize(requestQr: string) {
      const { qr, sas } = await pairing.holder.authorize({ qr: requestQr });
      ok = true;
      return { ackQr: qr, sas };
    },
    async confirm(wrapQr: string) {
      if (!ok) throw new Error("confirm() is only valid after authorize()");
      return pairing.holder.complete({ qr: wrapQr, sasConfirmed: true });
    },
    reject() {},
  };
}

export function usePairingCeremony(opts: { role: "import" | "export" }): PairingCeremony {
  const { role } = opts;
  const client = useSelfCustody();

  const qrRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [phase, setPhase] = useState<PairPhase>("loading");
  const [step, setStep] = useState<string>("");
  const [sas, setSas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canFinish, setCanFinish] = useState(false);

  // Promise resolvers bridging the imperative driver to the declarative UI.
  const scanTap = useRef<() => void>(() => {});
  const retry = useRef<() => void>(() => {});
  const sasResolve = useRef<(v: boolean) => void>(() => {});
  // Mirrors of the current QR-shown state / step for the transport closure (needs the CURRENT value).
  const shownRef = useRef(false);
  const stepRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    if (!qrRef.current || !videoRef.current) return;
    const base = createBrowserQrTransport({ qrContainer: qrRef.current, video: videoRef.current });
    const pairing = client.enrollAccessSlot.viaPairing;

    const transport: PairingTransport = {
      showCode: (code) => {
        base.showCode(code);
        shownRef.current = true;
        if (!cancelled) setPhase("show");
      },
      scanCode: async () => {
        // Gate on a tap (a device cannot detect that the other one scanned its QR). Keep our own QR up
        // ONLY during the enroller's `scan-ack` (there the request code must stay up for the other
        // side); every other scan hides the stale QR and shows a plain "open camera" prompt.
        const keepQrUp = stepRef.current === "scan-ack";
        await new Promise<void>((r) => {
          scanTap.current = r;
          if (!cancelled) setPhase(shownRef.current && keepQrUp ? "show" : "prompt-scan");
        });
        for (;;) {
          if (!cancelled) setPhase("scanning");
          try {
            const code = await base.scanCode();
            shownRef.current = false;
            // The driver now does real work with this code — for the holder's final scan that means a
            // passkey prompt AND an on-chain write. Show a busy state until the driver's next step.
            if (!cancelled) setPhase("working");
            return code;
          } catch (e) {
            if (e instanceof CameraUnavailableError) {
              await new Promise<void>((r) => {
                retry.current = r;
                if (!cancelled) setPhase("camera-error");
              });
              continue;
            }
            throw e;
          }
        }
      },
      stop: () => base.stop(),
    };

    const handlers = {
      onStep: (s: string) => {
        stepRef.current = s;
        if (cancelled) return;
        setStep(s);
        // The HOLDER (export) ends here: it scanned the wrap, wrote the access slot and paid. The
        // ENROLLER (import) ends holding its wrap code up for the holder to scan, and is NOT logged in
        // (it was handed no key) — the user finishes it with finish() → login().
        if (s === "done") {
          if (role === "export") setPhase("done");
          else setCanFinish(true);
        }
      },
      confirmSas: (s: string) =>
        new Promise<boolean>((r) => {
          sasResolve.current = r;
          if (!cancelled) {
            setSas(s);
            setPhase("sas");
          }
        }),
    };

    const runner =
      role === "import"
        ? runImportCeremony(setupController(pairing), transport, handlers)
        : runExportCeremony(authorizeController(pairing), transport, handlers);

    runner.catch((e: unknown) => {
      if (cancelled) return;
      if (e instanceof Error && /pairing cancelled/i.test(e.message)) setPhase("rejected");
      else setError(String(e));
    });

    return () => {
      cancelled = true;
      base.stop();
    };
    // Mount-once: the ceremony runs a single session bound to the mounted refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish(): Promise<void> {
    // The enroller logs in only now: its blob had to land on chain first (the holder's scan-wrap).
    if (role === "import") {
      try {
        await client.login();
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    setPhase("done");
  }

  return {
    phase,
    step,
    sas,
    error,
    canFinish,
    triggerScan: () => scanTap.current(),
    retryCamera: () => retry.current(),
    confirmSas: (matches: boolean) => sasResolve.current(matches),
    finish,
    qrRef,
    videoRef,
  };
}
