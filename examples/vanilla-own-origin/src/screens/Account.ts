/**
 * Account — framework-free port of react-own-origin's Account.tsx. "Managed on this
 * device" custody surface: danger-gated export (two-step; renders the two raw
 * private keys `export()` returns), the CHAIN-VERIFIED access-slot count ("ways into this
 * wallet" — never passkeyCount(), which counts local credentials and cannot tell a
 * access slot from an orphan), a sign-message tool (EVM + Solana), and secondary nav to
 * devices / access. Log out lives in the shell, not here.
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { classifySendError, type SendErrorKind } from "@avokjs/core/helpers";
import { Screen, Card, Field, Button, AddressText, ListRow, ErrorNote } from "../ui/index.js";

type Err = { kind: SendErrorKind; message: string } | null;
const txt = (v: string): Text => document.createTextNode(v);
const secLabel = { fontSize: "11px", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text3)", marginBottom: "10px" };

export function Account(ctx: Ctx): HTMLElement {
  const account = ctx.client.account();
  const root = el("div");
  let s = {
    exportStep: "idle" as "idle" | "confirm" | "done",
    exportErr: null as Err,
    exported: null as { evm: string; solana: string } | null,
    // The chain-verified number of ways into this wallet. NOT passkeyCount(), which counts local
    // credentials — it includes orphans (a credential whose slot write never landed) and so can
    // never be shown as a way in. The full roster lives on the Access screen.
    accessSlotCount: null as number | null,
    message: "Hello from Avok demo",
    evmSig: null as string | null,
    solSig: null as string | null,
    signErr: null as Err,
    evmSigning: false,
    solSigning: false,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  async function handleExport(): Promise<void> {
    set({ exportErr: null });
    try {
      // #3 split the single `export()` into a ROOT key and a LEAF key. exportEvmKey is the root —
      // it alone restores the whole wallet, both chains (VISION §5) — and exportSolanaKey is shown
      // only because this screen renders the Solana address too. Each is its own passkey gesture.
      const exported = { evm: await ctx.client.exportEvmKey(), solana: await ctx.client.exportSolanaKey() };
      set({ exported, exportStep: "done" });
    } catch (e) {
      set({ exportErr: classifySendError(e) });
    }
  }

  async function handleSignEvm(): Promise<void> {
    set({ signErr: null, evmSig: null, evmSigning: true });
    try {
      const sig = await ctx.client.evm.signMessage({ message: s.message });
      set({ evmSig: sig, evmSigning: false });
    } catch (e) {
      set({ signErr: classifySendError(e), evmSigning: false });
    }
  }

  async function handleSignSolana(): Promise<void> {
    set({ signErr: null, solSig: null, solSigning: true });
    try {
      const { signature } = await ctx.client.solana.signMessage(s.message);
      set({ solSig: signature, solSigning: false });
    } catch (e) {
      set({ signErr: classifySendError(e), solSigning: false });
    }
  }

  function view(): Node {
    if (!account) return el("div");

    return Screen(
      { title: "Account" },
      el("p", { style: { fontSize: "12px", color: "var(--text3)", marginBottom: "14px" } }, "Managed on this device — keys and passkeys never leave this browser."),

      // Identity
      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Identity"),
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" } },
          el("span", { style: { fontSize: "11px", width: "46px", color: "var(--text3)" } }, "EVM"),
          AddressText({ address: account.evm.address, copy: true }),
        ),
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" } },
          el("span", { style: { fontSize: "11px", width: "46px", color: "var(--text3)" } }, "Solana"),
          AddressText({ address: account.solana.address, copy: true }),
        ),
      ),

      // Security: the trust surface. The number here is the CHAIN-VERIFIED access-slot count — never
      // passkeyCount(), which counts local credentials and cannot tell an access slot from an orphan.
      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Security"),
        ListRow({
          title: txt("Ways into this wallet"),
          desc: txt(
            s.accessSlotCount === null ? "Checking…" : `${s.accessSlotCount} — every one can reach your wallet key.`,
          ),
          chevron: false,
        }),
        el(
          "div",
          { style: { marginTop: "10px", display: "flex", flexDirection: "column", gap: "9px" } },
          Button({ variant: "ghost", label: "Who can reach this wallet", onClick: () => ctx.go("access") }),
          Button({ variant: "ghost", label: "Manage devices", onClick: () => ctx.go("device") }),
        ),
      ),

      // Sign a message
      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Sign a message"),
        Field({
          label: "Message",
          value: s.message,
          placeholder: "Message to sign",
          onChange: (v) => {
            s.message = v;
          },
        }),
        el(
          "div",
          { style: { display: "flex", gap: "8px", marginBottom: "10px" } },
          Button({ variant: "ghost", label: s.evmSigning ? "Signing…" : "Sign (EVM)", disabled: s.evmSigning, onClick: () => void handleSignEvm() }),
          Button({ variant: "ghost", label: s.solSigning ? "Signing…" : "Sign (Solana)", disabled: s.solSigning, onClick: () => void handleSignSolana() }),
        ),
        s.signErr && ErrorNote(s.signErr),
        s.evmSig &&
          el(
            "div",
            { style: { marginBottom: "8px" } },
            el("div", { style: { fontSize: "11px", marginBottom: "4px", color: "var(--text3)" } }, "EVM signature"),
            AddressText({ address: s.evmSig, copy: true }),
          ),
        s.solSig &&
          el(
            "div",
            null,
            el("div", { style: { fontSize: "11px", marginBottom: "4px", color: "var(--text3)" } }, "Solana signature"),
            AddressText({ address: s.solSig, copy: true }),
          ),
      ),

      // Export — danger-gated
      Card(
        null,
        el("div", { style: secLabel }, "Export wallet"),
        s.exportStep === "done" && s.exported
          ? el(
              "div",
              null,
              el(
                "p",
                { style: { fontSize: "12px", marginBottom: "10px", color: "var(--danger)" } },
                "Anyone holding these keys controls the wallet. Store them securely and never share them.",
              ),
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" } },
                el("span", { style: { fontSize: "11px", width: "46px", color: "var(--text3)" } }, "EVM"),
                AddressText({ address: s.exported.evm, truncate: false, copy: true }),
              ),
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "6px" } },
                el("span", { style: { fontSize: "11px", width: "46px", color: "var(--text3)" } }, "Solana"),
                AddressText({ address: s.exported.solana, truncate: false, copy: true }),
              ),
            )
          : s.exportStep === "confirm"
            ? el(
                "div",
                null,
                el(
                  "p",
                  { style: { fontSize: "12px", marginBottom: "10px", color: "var(--text2)" } },
                  "This reveals your full recovery material to this app. Anyone with it controls the wallet. Make sure no one is watching your screen.",
                ),
                el(
                  "div",
                  { style: { display: "flex", gap: "8px" } },
                  Button({ variant: "ghost", label: "Cancel", onClick: () => set({ exportStep: "idle" }) }),
                  Button({ variant: "danger", label: "Confirm export", onClick: () => void handleExport() }),
                ),
              )
            : el(
                "div",
                null,
                el("p", { style: { fontSize: "12px", marginBottom: "10px", color: "var(--text2)" } }, "Reveals the raw recovery material for this wallet — high risk."),
                Button({ variant: "danger", label: "Export wallet", onClick: () => set({ exportStep: "confirm" }) }),
              ),
        s.exportErr && el("div", { style: { marginTop: "8px" } }, ErrorNote(s.exportErr)),
      ),
    );
  }

  root.replaceChildren(view());
  // Chain-verified and keyless, so it is safe to run after first paint (shows "Checking…" meanwhile).
  // A fresh, not-yet-delegated account has no vault contract on chain yet: zero access slots written.
  ctx.client
    .accessSlotCount()
    .then((accessSlotCount) => set({ accessSlotCount }))
    .catch(() => set({ accessSlotCount: 0 }));
  return root;
}
