import { useEffect, useRef, useState } from "react";
import { useSelfCustody } from "@avokjs/react";
import {
  runImportCeremony,
  runExportCeremony,
  type PairingTransport,
  type ImportStep,
  type ExportStep,
} from "@avokjs/helpers";
import { createBrowserQrTransport, CameraUnavailableError } from "@avokjs/helpers/qr";
import { Button, Card, Text } from "../ui/index.js";
import { createAuthorizeController, createSetupController } from "./controller.js";

/**
 * Web device pairing over QR (scan/display). The handshake codes travel as QR: this device shows a
 * QR, the other scans it, and vice-versa, across three rounds — with the 6-digit SAS confirmed on
 * both devices between rounds 2 and 3. QR-only, no paste fallback (camera required); a scan pane
 * shows a "camera blocked → retry" state if the camera is denied/absent. The transport + ceremony
 * driver live in @avokjs/helpers; this component is just the UI over them.
 */
type Role = "import" | "export";
type Phase = "loading" | "show" | "prompt-scan" | "scanning" | "working" | "camera-error" | "sas" | "done" | "rejected";

/**
 * Every step the driver emits that needs a caption. Typed against the DRIVER's own step unions on
 * purpose: this map used to be `Record<string, string>`, so when the ceremony's third round reversed
 * direction (the enroller now SHOWS its wrapping key and the holder SCANS it, instead of the holder
 * granting K) these captions kept the old `show-grant`/`scan-grant` names, compiled fine, and
 * silently resolved to `""`. The holder then sat on a blank pane and never scanned, so the access slot was
 * never written. A missing or misspelled step is now a COMPILE ERROR.
 */
type Captioned<S> = Exclude<S, "confirm-sas" | "done">;
const CAPTION: { import: Record<Captioned<ImportStep>, string>; export: Record<Captioned<ExportStep>, string> } = {
  import: {
    "show-request": "Show this code to your existing device.",
    "scan-ack": "Scan the reply shown on your existing device.",
    "show-wrap": "Show this final code to your existing device to finish.",
  },
  export: {
    "scan-request": "Scan the code shown on your new device.",
    "show-ack": "Show this to your new device.",
    "scan-wrap": "Scan the final code from your new device to add it.",
  },
};

/**
 * WHOSE TURN IS IT. Neither device said, so both looked equally "stuck": a QR on screen means "they
 * must act", a camera means "you must act", and there was nothing to tell them apart. Every step now
 * names the round and who is expected to move.
 */
const TURN: Record<Role, Record<string, { round: number; you: boolean; title: string }>> = {
  import: {
    "show-request": { round: 1, you: false, title: "Waiting for your other device to scan this" },
    "scan-ack": { round: 2, you: true, title: "Your turn — scan their reply" },
    "confirm-sas": { round: 2, you: true, title: "Check the code matches" },
    "show-wrap": { round: 3, you: false, title: "Waiting for your other device to finish" },
    done: { round: 3, you: false, title: "Done" },
  },
  export: {
    "scan-request": { round: 1, you: true, title: "Your turn — scan their code" },
    "show-ack": { round: 2, you: false, title: "Waiting for your new device to scan this" },
    "confirm-sas": { round: 2, you: true, title: "Check the code matches" },
    "scan-wrap": { round: 3, you: true, title: "Your turn — scan their final code" },
    done: { round: 3, you: false, title: "Done" },
  },
};

function TurnBar({ role, step, working }: { role: Role; step: string; working: boolean }) {
  const t = TURN[role][step];
  if (!t) return null;
  const title = working ? "Writing the access slot on chain…" : t.title;
  const yours = working ? false : t.you;
  return (
    <div style={{ textAlign: "center", marginBottom: 10 }}>
      <Text variant="micro" tone="subtle" as="div" style={{ marginBottom: 2 }}>
        Step {t.round} of 3 · {role === "export" ? "this device holds the wallet" : "this device is new"}
      </Text>
      <Text variant="label" tone={yours ? "default" : "subtle"} as="div">
        {yours ? "\u25B6 " : ""}
        {title}
      </Text>
    </div>
  );
}

function StepDots({ index }: { index: number }) {
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 12 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 18, height: 3, borderRadius: 2, background: i <= index ? "var(--accent, #4ea)" : "var(--border, #444)" }} />
      ))}
    </div>
  );
}

function stepIndex(step: string): number {
  if (step === "show-request" || step === "scan-ack" || step === "scan-request") return 0;
  if (step === "confirm-sas" || step === "show-ack") return 1;
  return 2; // show-wrap (enroller) / scan-wrap (holder)
}

function Sas({ sas, onYes, onNo }: { sas: string; onYes: () => void; onNo: () => void }) {
  return (
    <div style={{ textAlign: "center", margin: "6px 0 0" }}>
      <Text variant="label" tone="muted" as="div" style={{ marginBottom: 8 }}>
        Confirm this code matches on both devices:
      </Text>
      <Text variant="display" mono as="div" style={{ letterSpacing: 6, marginBottom: 14 }}>
        {sas}
      </Text>
      <Button variant="primary" onClick={onYes}>Codes match — continue</Button>
      <div style={{ height: 8 }} />
      <Button variant="danger" onClick={onNo}>Codes don’t match — cancel</Button>
    </div>
  );
}

function Rejected() {
  return (
    <Card>
      <Text variant="value" tone="muted" as="p" style={{ margin: 0 }}>
        Pairing cancelled — the codes didn’t match. Nothing was authorized. Start over if that was a mistake.
      </Text>
    </Card>
  );
}

function Ceremony({ role, onDone, done }: { role: Role; onDone: () => void; done: React.ReactNode }) {
  const client = useSelfCustody();
  const pairing = client.enrollAccessSlot.viaPairing;
  const qrRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [step, setStep] = useState<string>("");
  const [sas, setSas] = useState("");
  const [showingQr, setShowingQr] = useState(false);
  const [scanTapReady, setScanTapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Promise resolvers bridging the imperative driver to the declarative UI.
  const scanTap = useRef<() => void>(() => {});
  const retry = useRef<() => void>(() => {});
  const sasResolve = useRef<(v: boolean) => void>(() => {});
  // Mirrors `showingQr` for the transport closure (which needs the CURRENT value, not a stale one).
  const shownRef = useRef(false);
  // Same, for the current step: the transport must know WHICH scan it is being asked for.
  const stepRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    if (!qrRef.current || !videoRef.current) return;
    const base = createBrowserQrTransport({ qrContainer: qrRef.current, video: videoRef.current });

    // Gate each scan behind a user tap (a device can't detect the other scanned its QR), and turn a
    // CameraUnavailableError into a retryable camera-blocked pane.
    const transport: PairingTransport = {
      showCode: (code) => { base.showCode(code); shownRef.current = true; if (!cancelled) { setShowingQr(true); setPhase("show"); } },
      scanCode: async () => {
        // Gate on a tap (a device cannot detect that the other one scanned its QR).
        //
        // Keep our own QR up ONLY during the enroller's `scan-ack`: there, B is still holding its
        // request code up for A to scan, so hiding it would break the other side. Every other scan
        // (A's `scan-request`, and A's `scan-wrap` — where B has already taken our ack) must HIDE the
        // stale QR and show a plain "open camera" prompt. Deciding this from `shownRef` alone left the
        // holder staring at a dead ack QR at scan-wrap, looking like it was showing a code when it was
        // really waiting to scan one — so the access slot never got written.
        const keepQrUp = stepRef.current === "scan-ack";
        await new Promise<void>((r) => {
          scanTap.current = r;
          if (!cancelled) { setScanTapReady(true); setPhase(shownRef.current && keepQrUp ? "show" : "prompt-scan"); }
        });
        setScanTapReady(false);
        for (;;) {
          if (!cancelled) setPhase("scanning");
          try {
            const code = await base.scanCode();
            shownRef.current = false;
            // The driver now does real work with this code — for the holder's final scan that means a
            // passkey prompt AND an on-chain write, several seconds. Leaving the UI on the scanning
            // pane made the device look frozen. Show a busy state until the driver's next step.
            if (!cancelled) { setShowingQr(false); setPhase("working"); }
            return code;
          } catch (e) {
            if (e instanceof CameraUnavailableError) {
              await new Promise<void>((r) => { retry.current = r; if (!cancelled) setPhase("camera-error"); });
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
        // The HOLDER ends here: it scanned the wrap, wrote the access slot and paid. Only the ENROLLER stops
        // on a visible code (its Done button runs continue()), so it must NOT be dismissed by this.
        if (s === "done" && role === "export") setPhase("done");
      },
      confirmSas: (s: string) => new Promise<boolean>((r) => { sasResolve.current = r; if (!cancelled) { setSas(s); setPhase("sas"); } }),
    };

    const runner = role === "import"
      ? runImportCeremony(createSetupController(pairing), transport, handlers)
      : runExportCeremony(createAuthorizeController(pairing), transport, handlers);
    // BOTH roles now end with something on screen and a Done button (handled in render):
    //  - the enroller ends on show-wrap: its wrapping key stays up for the holder to scan. It is NOT
    //    logged in — it was handed no key — so Done runs continue() to log in against the access slot the
    //    holder just wrote. (That is the one cost of never putting the wallet key on the wire.)
    //  - the holder ends after scanning the wrap and writing the access slot; Done just dismisses.

    runner.catch((e) => {
      if (cancelled) return;
      if (e instanceof Error && /pairing cancelled/i.test(e.message)) setPhase("rejected");
      else setError(String(e));
    });

    return () => { cancelled = true; base.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "rejected") return <Rejected />;
  if (phase === "done") return <>{done}</>;

  const caption = (CAPTION[role] as Record<string, string>)[step] ?? "";
  // The ENROLLER ends holding a code up — its wrapping key — for the holder to scan. This is the step
  // that renders its Done button (which runs continue(), because the ceremony handed it no key).
  const isGrantShow = step === "show-wrap";

  return (
    <div>
      <StepDots index={stepIndex(step)} />
      <TurnBar role={role} step={step} working={phase === "working"} />

      {/* QR display — visible while showing a code (incl. during A's SAS step, where the ack QR stays up). */}
      <div
        ref={qrRef}
        style={{ display: showingQr && (phase === "show" || phase === "sas") ? "flex" : "none", justifyContent: "center", margin: "4px 0 12px" }}
      />
      {/* Camera — visible only while scanning. */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ display: phase === "scanning" ? "block" : "none", width: "100%", maxHeight: 260, borderRadius: 12, background: "#000", marginBottom: 12 }}
      />

      {phase === "loading" && <Text variant="body" tone="subtle" as="p">Preparing…</Text>}

      {/* The holder's final scan hands off to an on-chain write that takes seconds and asks for the
          passkey. Without this the device sat on the scanning pane and looked hung. */}
      {phase === "working" && (
        <Text variant="label" tone="subtle" as="p" style={{ textAlign: "center", margin: 0 }}>
          {role === "export"
            ? "Approve with your passkey — this writes the new device's access slot on chain and pays for it."
            : "Working…"}
        </Text>
      )}

      {phase === "show" && (
        <>
          <Text variant="label" tone="subtle" as="p" style={{ margin: "0 0 12px", textAlign: "center" }}>{caption}</Text>
          {isGrantShow ? (
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  // The enroller logs in only now: its blob had to land on chain first.
                  if (role === "import") await client.login();
                  setPhase("done");
                  onDone();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Done
            </Button>
          ) : scanTapReady ? (
            <Button variant="primary" onClick={() => scanTap.current()}>Scan their reply ›</Button>
          ) : null}
        </>
      )}

      {phase === "prompt-scan" && (
        <>
          <Text variant="label" tone="subtle" as="p" style={{ margin: "0 0 12px", textAlign: "center" }}>{caption}</Text>
          <Button variant="primary" onClick={() => scanTap.current()}>Open camera ›</Button>
        </>
      )}

      {phase === "scanning" && (
        <Text variant="label" tone="subtle" as="p" style={{ margin: 0, textAlign: "center" }}>
          {caption || "Point the camera at the other device's code."}
        </Text>
      )}

      {phase === "camera-error" && (
        <Card>
          <Text variant="label" tone="danger" as="p" style={{ margin: "0 0 10px" }}>
            Camera blocked. Pairing needs the camera — allow camera access for this site, then retry.
          </Text>
          <Button variant="primary" onClick={() => retry.current()}>Retry</Button>
        </Card>
      )}

      {phase === "sas" && <Sas sas={sas} onYes={() => sasResolve.current(true)} onNo={() => sasResolve.current(false)} />}

      {error && <Text variant="label" tone="danger" as="p" style={{ marginTop: 10 }}>{error}</Text>}
    </div>
  );
}

/**
 * New device (B), the ENROLLER: show request → scan ack → confirm SAS → mint this device's credential
 * → SHOW its wrapping key → done. It never receives the wallet key, so it is not logged in by the
 * ceremony: Done runs continue(), which reads the blob the holder just wrote.
 *
 * The credential is minted LAST on purpose — only after the SAS has ruled out a MITM, and only after
 * the holder has proven (in authorize()) that it can pay for the write. Minting earlier would create
 * exactly the orphaned credential that preflight exists to prevent.
 *
 * Exported because Onboard renders it too — a fresh device whose credential does not sync here joins
 * an existing wallet through exactly this B-side ceremony (the funded-tx warning is shown by the caller).
 */
export function SetupFlow({ onDone }: { onDone: () => void }) {
  return (
    <Ceremony
      role="import"
      onDone={onDone}
      done={
        <Text variant="value" tone="muted" as="p">
          This device is set up. Its own passkey is enrolled and an encrypted copy of your key was written
          on chain during setup — that on-chain copy is what lets this device log back in after a reload.
        </Text>
      }
    />
  );
}

/** Existing device (A), the HOLDER: scan request → show ack + confirm SAS → SCAN the enroller's
 *  wrapping key → seal K under it, write the access slot on chain, and PAY. Rendered by the logged-in Devices
 *  screen: this device already holds the wallet, so it only ever AUTHORIZES a new device (the "this
 *  device is new" B-side lives on Onboard's "Set up this device").
 *
 *  The wallet key NEVER travels. A seals K under a wrapping key B derived from its own PRF; B gets a
 *  access slot, not the key on the wire. */
export function AuthorizeFlow() {
  return <Ceremony role="export" onDone={() => {}} done={<Text variant="value" tone="muted" as="p">Done — the new device has your wallet.</Text>} />;
}
