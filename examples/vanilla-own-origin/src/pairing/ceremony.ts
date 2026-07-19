/**
 * Framework-free QR pairing ceremony (both roles) — the el() twin of react-own-origin's Ceremony.
 * The handshake codes travel as QR: this device shows a QR, the other scans it, and vice-versa,
 * across three rounds, with the 6-digit SAS confirmed on both between rounds 2 and 3. QR-only (no
 * paste); a scan pane swaps to a "camera blocked → retry" state when the camera is denied/absent.
 * The transport + ceremony driver live in @avokjs/core/helpers; this is only the UI over them.
 */
import { el } from "../core/el.js";
import {
  runImportCeremony,
  runExportCeremony,
  type PairingTransport,
  type ImportStep,
  type ExportStep,
} from "@avokjs/core/helpers";
import { createBrowserQrTransport, CameraUnavailableError } from "@avokjs/core/qr";
import { Button, Card } from "../ui/index.js";
import { createSetupController, createAuthorizeController } from "./controller.js";
import type { Account } from "@avokjs/core";

type Role = "import" | "export";
type Phase = "loading" | "show" | "prompt-scan" | "scanning" | "working" | "camera-error" | "sas" | "done" | "rejected";
type Pairing = Parameters<typeof createSetupController>[0];

/**
 * Typed against the DRIVER's own step unions on purpose. As `Record<string, string>` a wrong step name
 * compiled fine and silently resolved to `""` — which is exactly how the React demo shipped the OLD
 * ceremony's `show-grant`/`scan-grant` captions after the third round reversed direction, leaving the
 * holder on a blank pane that never scanned, so the access slot was never written. Now it is a COMPILE ERROR.
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
 * must act", a camera means "you must act", and nothing distinguished them. Every step now names the
 * round and who is expected to move.
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

function turnBar(role: Role, step: string, working: boolean): Node {
  const t = TURN[role][step];
  if (!t) return el("span");
  const title = working ? "Writing the access slot on chain…" : t.title;
  const yours = working ? false : t.you;
  return el(
    "div",
    { style: { textAlign: "center", marginBottom: "10px" } },
    el(
      "div",
      { style: { fontSize: "11px", color: "var(--text3)", marginBottom: "2px" } },
      `Step ${t.round} of 3 · ${role === "export" ? "this device holds the wallet" : "this device is new"}`,
    ),
    el(
      "div",
      { style: { fontSize: "12px", color: yours ? "var(--text)" : "var(--text3)", fontWeight: yours ? "600" : "400" } },
      `${yours ? "\u25B6 " : ""}${title}`,
    ),
  );
}

function stepIndex(step: string): number {
  if (step === "show-request" || step === "scan-ack" || step === "scan-request") return 0;
  if (step === "confirm-sas" || step === "show-ack") return 1;
  return 2;
}

function stepDots(index: number): Node {
  return el(
    "div",
    { style: { display: "flex", gap: "4px", justifyContent: "center", marginBottom: "12px" } },
    ...[0, 1, 2].map((i) =>
      el("span", {
        style: {
          width: "18px",
          height: "3px",
          borderRadius: "2px",
          background: i <= index ? "var(--ink)" : "var(--border)",
        },
      }),
    ),
  );
}

export function Ceremony(opts: {
  role: Role;
  pairing: Pairing;
  /** import → the enrolled Account; export → no argument. */
  onComplete: (account?: Account) => void;
  doneText: string;
}): HTMLElement {
  const root = el("div");

  // Persistent nodes the transport renders/scans into — reused across re-renders (never recreated).
  const qrBox = el("div");
  Object.assign(qrBox.style, { justifyContent: "center", margin: "4px 0 12px" });
  const video = el("video") as HTMLVideoElement;
  video.playsInline = true;
  video.muted = true;
  Object.assign(video.style, {
    width: "100%",
    maxHeight: "260px",
    borderRadius: "12px",
    background: "#000",
    marginBottom: "12px",
  });

  let s = {
    phase: "loading" as Phase,
    step: "",
    sas: "",
    showingQr: false,
    scanTapReady: false,
    error: null as string | null,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    render();
  };

  let scanTap: () => void = () => {};
  let retry: () => void = () => {};
  let sasResolve: (v: boolean) => void = () => {};

  const base = createBrowserQrTransport({ qrContainer: qrBox, video });

  // Gate each scan behind a user tap (a device can't detect the other scanned its QR), and turn a
  // CameraUnavailableError into a retryable camera-blocked pane.
  const transport: PairingTransport = {
    showCode: (code) => {
      base.showCode(code);
      set({ showingQr: true, phase: "show" });
    },
    scanCode: async () => {
      // Gate on a tap (a device cannot detect that the other one scanned its QR).
      //
      // Keep our own QR up ONLY during the enroller's `scan-ack`: there, B is still holding its request
      // code up for A to scan, so hiding it would break the other side. Every other scan (A's
      // `scan-request`, and A's `scan-wrap` — where B has already taken our ack) must HIDE the stale QR
      // and show a plain "open camera" prompt, or the holder sits looking at a dead ack QR as though it
      // were showing a code, when it is really waiting to scan one.
      const keepQrUp = s.step === "scan-ack";
      await new Promise<void>((r) => {
        scanTap = r;
        set({ scanTapReady: true, phase: s.showingQr && keepQrUp ? "show" : "prompt-scan" });
      });
      set({ scanTapReady: false });
      for (;;) {
        set({ phase: "scanning" });
        try {
          const code = await base.scanCode();
          // The driver now does real work with this code — for the holder's final scan that is a
          // passkey prompt AND an on-chain write, several seconds. Leaving the UI on the scanning pane
          // made the device look frozen.
          set({ showingQr: false, phase: "working" });
          return code;
        } catch (e) {
          if (e instanceof CameraUnavailableError) {
            await new Promise<void>((r) => {
              retry = r;
              set({ phase: "camera-error" });
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
    onStep: (step: string) => {
      // The HOLDER ends here: it scanned the wrap, wrote the access slot and paid. The ENROLLER must NOT be
      // dismissed — it stops on a visible code, and its Done button runs continue().
      if (step === "done" && opts.role === "export") set({ step, phase: "done" });
      else set({ step });
    },
    confirmSas: (sas: string) =>
      new Promise<boolean>((r) => {
        sasResolve = r;
        set({ sas, phase: "sas" });
      }),
  };

  function view(): Node {
    if (s.phase === "rejected") {
      return Card(
        null,
        el(
          "p",
          { style: { fontSize: "13px", color: "var(--text2)", margin: "0" } },
          "Pairing cancelled — the codes didn't match. Nothing was authorized. Start over if that was a mistake.",
        ),
      );
    }
    if (s.phase === "done") {
      return el("p", { style: { fontSize: "13px", color: "var(--text2)" } }, opts.doneText);
    }

    const caption = (CAPTION[opts.role] as Record<string, string>)[s.step] ?? "";
    // The ENROLLER now ends holding a code up (its wrapping key) for the holder to scan.
    const isGrantShow = s.step === "show-wrap";

    // Toggle the persistent nodes' visibility for this phase.
    qrBox.style.display = s.showingQr && (s.phase === "show" || s.phase === "sas") ? "flex" : "none";
    video.style.display = s.phase === "scanning" ? "block" : "none";

    return el(
      "div",
      null,
      stepDots(stepIndex(s.step)),
      turnBar(opts.role, s.step, s.phase === "working"),
      qrBox,
      video,

      s.phase === "loading" && el("p", { style: { fontSize: "13px", color: "var(--text3)" } }, "Preparing…"),

      s.phase === "working" &&
        el(
          "p",
          { style: { fontSize: "12px", color: "var(--text3)", textAlign: "center", margin: "0" } },
          opts.role === "export"
            ? "Approve with your passkey — this writes the new device's access slot on chain and pays for it."
            : "Working…",
        ),

      s.phase === "show" &&
        el(
          "div",
          null,
          el(
            "p",
            { style: { fontSize: "12px", color: "var(--text3)", margin: "0 0 12px", textAlign: "center" } },
            caption,
          ),
          isGrantShow
            ? Button({
                variant: "primary",
                label: "Done",
                onClick: () => {
                  transport.stop();
                  set({ phase: "done" });
                  opts.onComplete();
                },
              })
            : s.scanTapReady
              ? Button({ variant: "primary", label: "Scan their reply ›", onClick: () => scanTap() })
              : el("span"),
        ),

      s.phase === "prompt-scan" &&
        el(
          "div",
          null,
          el(
            "p",
            { style: { fontSize: "12px", color: "var(--text3)", margin: "0 0 12px", textAlign: "center" } },
            caption,
          ),
          Button({ variant: "primary", label: "Open camera ›", onClick: () => scanTap() }),
        ),

      s.phase === "scanning" &&
        el(
          "p",
          { style: { fontSize: "12px", color: "var(--text3)", margin: "0", textAlign: "center" } },
          caption || "Point the camera at the other device's code.",
        ),

      s.phase === "camera-error" &&
        Card(
          null,
          el(
            "p",
            { style: { fontSize: "12px", color: "var(--danger)", margin: "0 0 10px" } },
            "Camera blocked. Pairing needs the camera — allow camera access for this site, then retry.",
          ),
          Button({ variant: "primary", label: "Retry", onClick: () => retry() }),
        ),

      s.phase === "sas" &&
        el(
          "div",
          { style: { textAlign: "center", margin: "6px 0 0" } },
          el(
            "div",
            { style: { fontSize: "12px", color: "var(--text2)", marginBottom: "8px" } },
            "Confirm this code matches on both devices:",
          ),
          el(
            "div",
            {
              style: {
                fontSize: "30px",
                letterSpacing: "6px",
                fontFamily: "var(--font-mono)",
                color: "var(--text)",
                marginBottom: "14px",
              },
            },
            s.sas,
          ),
          Button({ variant: "primary", label: "Codes match — continue", onClick: () => sasResolve(true) }),
          el("div", { style: { height: "8px" } }),
          Button({ variant: "danger", label: "Codes don’t match — cancel", onClick: () => sasResolve(false) }),
        ),

      s.error && el("p", { style: { color: "var(--danger)", fontSize: "12px", marginTop: "10px" } }, s.error),
    );
  }

  function render(): void {
    root.replaceChildren(view());
  }

  render();

  const runner =
    opts.role === "import"
      ? runImportCeremony(createSetupController(opts.pairing), transport, handlers)
      : runExportCeremony(createAuthorizeController(opts.pairing), transport, handlers);
  // The ENROLLER ends on show-wrap: its wrapping key stays up for the holder to scan, and a Done button
  // (in view()) then calls onComplete — the app logs in with continue(), because the enroller was handed
  // no key and its blob only exists once the holder has written it.
  // The HOLDER ends after scanning that wrap and writing the access slot.

  void runner.catch((e) => {
    if (e instanceof Error && /pairing cancelled/i.test(e.message)) set({ phase: "rejected" });
    else set({ error: String(e) });
  });

  return root;
}
