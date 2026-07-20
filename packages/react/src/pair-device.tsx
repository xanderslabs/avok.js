/**
 * <PairDevice role> — the SDK's thin, structural default for the QR pairing ceremony, rendered over
 * usePairingCeremony. STRUCTURE ONLY: inline layout, plain-English captions (override via `captions`),
 * and colours via CSS custom properties (var(--accent) / var(--border)) — no design tokens or theme
 * surface enter the SDK. Drop it in to get running, or ignore it and render your own over the hook.
 * The demos keep their polished, branded PairDevice as the "restyled it ourselves" reference.
 *
 *   role="import"  → this device is NEW: it shows a request code, scans the reply, confirms the SAS,
 *                    shows its wrap code, then (once the other device has scanned it) taps Done → login.
 *   role="export"  → this device HOLDS the wallet: it scans the new device's code, shows an ack,
 *                    confirms the SAS, scans the wrap code, writes the access slot on chain, and pays.
 */
import { useEffect } from "react";
import { usePairingCeremony } from "./pairing.js";

// PairDevice is the QR surface, so its copy may name cameras — the step IDs themselves deliberately
// do not, because the same ceremony runs over postMessage where nothing is shown or scanned. An app
// on that transport supplies its own captions for the same four steps.
const DEFAULT_CAPTIONS: Record<string, string> = {
  // Holder — the device that already has the wallet.
  "send-invite": "Show this code to the device you are adding.",
  "await-wrap": "Now scan the code shown on that device.",
  // Enroller — the device being added.
  "await-invite": "Scan the code shown on your existing device.",
  "send-wrap": "Show this code back to your existing device.",
  // Both.
  "confirm-sas": "Check that both devices show the same six digits.",
  done: "Done.",
};

export function PairDevice({
  role,
  captions,
  onDone,
}: {
  role: "import" | "export";
  captions?: Partial<Record<string, string>>;
  onDone?: () => void;
}): React.JSX.Element {
  const c = usePairingCeremony({ role });
  const caption = (captions?.[c.step] ?? DEFAULT_CAPTIONS[c.step]) ?? "";

  // The export (holder) side completes on its own; fire onDone once when it does.
  useEffect(() => {
    if (c.phase === "done") onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.phase]);

  if (c.phase === "rejected") {
    return (
      <p style={{ color: "var(--danger, #b91c1c)" }}>
        Pairing cancelled — the codes didn’t match. Nothing was authorized.
      </p>
    );
  }

  return (
    <div style={{ font: "14px system-ui", textAlign: "center", maxWidth: 360, margin: "0 auto" }}>
      {/* QR container — visible while showing a code. */}
      <div ref={c.qrRef} style={{ display: c.phase === "show" || c.phase === "sas" ? "flex" : "none", justifyContent: "center", margin: "8px 0" }} />
      {/* Camera — visible only while scanning. */}
      <video
        ref={c.videoRef}
        playsInline
        muted
        style={{ display: c.phase === "scanning" ? "block" : "none", width: "100%", maxHeight: 260, borderRadius: 12, background: "#000", margin: "8px 0" }}
      />

      {c.phase === "loading" && <p>Preparing…</p>}
      {caption && (c.phase === "show" || c.phase === "prompt-scan" || c.phase === "scanning") && <p>{caption}</p>}

      {c.phase === "prompt-scan" && (
        <button style={{ borderColor: "var(--accent, #4ea)" }} onClick={c.triggerScan}>
          Open camera ›
        </button>
      )}

      {/* On a shown code that is not the enroller's terminal, the user taps to move to the next scan. */}
      {c.phase === "show" && !c.canFinish && (
        <button style={{ borderColor: "var(--accent, #4ea)" }} onClick={c.triggerScan}>
          Scan their reply ›
        </button>
      )}

      {c.canFinish && (
        <button style={{ borderColor: "var(--accent, #4ea)" }} onClick={() => void c.finish().then(onDone)}>
          Done
        </button>
      )}

      {c.phase === "working" && <p>Working… approve with your passkey if prompted.</p>}

      {c.phase === "camera-error" && (
        <div>
          <p style={{ color: "var(--danger, #b91c1c)" }}>Camera blocked. Allow camera access, then retry.</p>
          <button onClick={c.retryCamera}>Retry</button>
        </div>
      )}

      {c.phase === "sas" && (
        <div>
          <p>Confirm this code matches on both devices:</p>
          <div style={{ fontSize: 22, letterSpacing: 6, fontFamily: "monospace", margin: "8px 0" }}>{c.sas}</div>
          <button style={{ borderColor: "var(--accent, #4ea)" }} onClick={() => c.confirmSas(true)}>
            Codes match — continue
          </button>{" "}
          <button style={{ borderColor: "var(--danger, #b91c1c)" }} onClick={() => c.confirmSas(false)}>
            Codes don’t match — cancel
          </button>
        </div>
      )}

      {c.phase === "done" && <p>Done.</p>}
      {c.error && <p style={{ color: "var(--danger, #b91c1c)" }}>{c.error}</p>}
    </div>
  );
}
