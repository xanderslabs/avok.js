/**
 * usePairingCeremony (React Native) — the headless device-pairing state machine, identical in shape to
 * @avokjs/react's, but with the transport INJECTED rather than created from DOM refs. It imports
 * nothing native and nothing DOM: the ceremony driver comes from the platform-agnostic
 * `@avokjs/core/helpers`, and the camera/QR transport is supplied by the caller (see
 * createExpoCameraTransport, or bring your own PairingTransport). Rendering is the app's — draw the
 * phases over the returned state, in React Native views.
 *
 * (Re-implemented here rather than shared with @avokjs/react: that package's graph pulls react-dom.
 * The DRY tradeoff is the same one AvokProvider/hooks already make to keep the RN graph DOM-free.)
 *
 * ONE CEREMONY, THREE CODES — and the wallet key never travels (see @avokjs/core/helpers' pairing).
 */
import { useEffect, useRef, useState } from "react";
import {
  runImportCeremony,
  runExportCeremony,
  CameraUnavailableError,
  type PairingTransport,
  type PairingVerbs,
} from "@avokjs/core/helpers";
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
  /** The enroller (import) ends holding its wrap code up; once the holder has scanned it, finish() logs in. */
  canFinish: boolean;
  triggerScan(): void;
  retryCamera(): void;
  confirmSas(matches: boolean): void;
  finish(): Promise<void>;
}

// The SAS-gated controllers (framework-free). The verbs that assert sasConfirmed:true are reachable
// ONLY via confirm(), and only after the handshake — kept out of the render path.

function setupController(pairing: PairingVerbs) {
  return {
    async mintAndWrap(inviteQr: string) {
      // One call now: read the invite, mint the credential, seal W, and return the digits. The
      // enroller has no state to keep between rounds because there is only one round on this side.
      const { qr, sas } = await pairing.enroller.mintAndWrap(inviteQr);
      return { wrapQr: qr, sas };
    },
    // On a SAS mismatch the credential just minted is BURNED — a retry runs mintAndWrap again and
    // mints a fresh one, which is what keeps an intercepted wrapping key worthless.
    reject() {},
  };
}

function authorizeController(pairing: PairingVerbs) {
  let ok = false;
  return {
    async invite() {
      const { qr } = await pairing.holder.invite();
      return { inviteQr: qr };
    },
    async receiveWrap(wrapQr: string) {
      // Decrypts, and deliberately does NOT release the wrapping key: it stays behind the gate that
      // only complete() opens, after the user has compared digits.
      const { sas } = await pairing.holder.receiveWrap(wrapQr);
      ok = true;
      return { sas };
    },
    async confirm() {
      if (!ok) throw new Error("confirm() is only valid after receiveWrap()");
      return pairing.holder.complete({ sasConfirmed: true });
    },
    reject() {},
  };
}

export function usePairingCeremony(opts: { role: "import" | "export"; transport: PairingTransport }): PairingCeremony {
  const { role, transport: base } = opts;
  const client = useSelfCustody();

  const [phase, setPhase] = useState<PairPhase>("loading");
  const [step, setStep] = useState<string>("");
  const [sas, setSas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canFinish, setCanFinish] = useState(false);

  const scanTap = useRef<() => void>(() => {});
  const retry = useRef<() => void>(() => {});
  const sasResolve = useRef<(v: boolean) => void>(() => {});
  const shownRef = useRef(false);
  const stepRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const pairing = client.enrollAccessSlot.viaPairing;

    // Wrap the injected transport with the same tap-gating + camera-error + busy-state choreography the
    // browser hook applies. `base` renders the camera/QR into the app's own React Native views.
    const transport: PairingTransport = {
      showCode: (code) => {
        base.showCode(code);
        shownRef.current = true;
        if (!cancelled) setPhase("show");
      },
      scanCode: async () => {
        const keepQrUp = stepRef.current === "await-invite";
        await new Promise<void>((r) => {
          scanTap.current = r;
          if (!cancelled) setPhase(shownRef.current && keepQrUp ? "show" : "prompt-scan");
        });
        for (;;) {
          if (!cancelled) setPhase("scanning");
          try {
            const code = await base.scanCode();
            shownRef.current = false;
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
    // Mount-once: a single ceremony session bound to the injected transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish(): Promise<void> {
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
  };
}
