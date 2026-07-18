/**
 * <AuthPopup config> — the wallet-sandbox popup as a React component, for a developer whose hosted
 * auth page is itself a React app. It is a THIN React renderer over the SAME framework-free ceremony
 * driver the plain-JS `mountAuthPopup` uses (`runAuthPopup` + `authPopupDeps` from
 * `@avokjs/core/auth-popup`), so the money path — decode, consent, the passkey gesture, the reply
 * shapes — has one implementation, not two.
 *
 * IMPORTANT — hardening is the emitter's job, not this component's. The SDK's recommended, guaranteed
 * path is the plain-JS emitter (`pnpm emit:auth-page` / `avok build-auth-page`), which produces a
 * fully-inlined, CSP-locked artifact. A page you hand-build around <AuthPopup> is YOUR responsibility
 * to inline + lock down — the "no external script can share the key-reconstruction origin" invariant
 * only holds for the emitted artifact.
 */
import { useEffect, useRef, useState } from "react";
import { runAuthPopup, authPopupDeps, type AuthPopupConfig, type AuthPopupView } from "@avokjs/core/auth-popup";

type Phase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "consent"; lines: string[]; error?: string; rejectOnly: boolean }
  | { kind: "waiting" }
  | { kind: "failure"; message: string };

export function AuthPopup({ config }: { config: AuthPopupConfig }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Bridges the driver's imperative `showConsent(): Promise<boolean>` to the declarative buttons.
  const consentResolve = useRef<((approved: boolean) => void) | null>(null);

  useEffect(() => {
    const view: AuthPopupView = {
      connecting: () => setPhase({ kind: "connecting" }),
      waitingForPasskey: () => setPhase({ kind: "waiting" }),
      failure: (message) => setPhase({ kind: "failure", message }),
      showConsent: (lines, opts) =>
        new Promise<boolean>((resolve) => {
          consentResolve.current = resolve;
          setPhase({ kind: "consent", lines, error: opts?.error, rejectOnly: opts?.rejectOnly ?? false });
        }),
    };
    return runAuthPopup({ ...authPopupDeps(config), view });
    // Mount-once: the popup services exactly one opener session. config is captured at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function decide(approved: boolean): void {
    const resolve = consentResolve.current;
    consentResolve.current = null;
    resolve?.(approved);
  }

  if (phase.kind === "consent") {
    return (
      <div style={{ font: "14px system-ui", padding: 20, maxWidth: 380, margin: "0 auto" }}>
        <div style={{ fontWeight: 600, margin: "8px 0" }}>Signing request</div>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12, background: "#f4f4f5", padding: 12, borderRadius: 8 }}>
          {phase.lines.join("\n")}
        </pre>
        {phase.error && <div style={{ color: "#b91c1c", fontSize: 12, marginTop: 8 }}>Error: {phase.error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => decide(false)}>{phase.rejectOnly ? "Close" : "Reject"}</button>
          {!phase.rejectOnly && <button onClick={() => decide(true)}>Approve</button>}
        </div>
      </div>
    );
  }

  const text =
    phase.kind === "connecting"
      ? "Signing you in…"
      : phase.kind === "waiting"
        ? "Waiting for passkey…"
        : phase.kind === "failure"
          ? `Sign-in failed: ${phase.message}`
          : "Loading…";
  return <p style={{ font: "16px system-ui", padding: 24 }}>{text}</p>;
}
