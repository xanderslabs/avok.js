/**
 * Device — framework-free port of react-own-origin's Devices screen (+ the addPasskey verb). Add a
 * passkey enrols a new passkey on THIS device. "Export to a device" is the A-side of the QR pairing
 * ceremony: this device already holds the wallet, so it only ever AUTHORIZES a new device (the
 * "this device is new" B-side lives on Onboard's "Set up this device"). The SAS gate is explicit —
 * the grant is revealed ONLY after the user affirms the 6-digit code matched, with an explicit
 * "codes don't match — cancel" that abandons the session (never grants).
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { Screen, Card, Button } from "../ui/index.js";
import { Ceremony } from "../pairing/ceremony.js";

const secLabel = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  color: "var(--text3)",
  marginBottom: "10px",
};
const errText = { color: "var(--danger)", fontSize: "12px", marginTop: "10px" };

export function Device(ctx: Ctx): HTMLElement {
  const root = el("div");
  // Built once — the ceremony starts on construction, so it must never be recreated by a re-render.
  const ceremonyNode = Ceremony({
    role: "export",
    pairing: ctx.client.enrollAccessSlot.viaPairing,
    doneText: "Done — the new device has your wallet.",
    onComplete: () => {},
  });

  let s = {
    adding: false,
    addResult: null as number | null,
    addErr: null as string | null,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  async function handleAddPasskey(): Promise<void> {
    set({ adding: true, addErr: null });
    try {
      const { passkeyCount } = await ctx.client.enrollAccessSlot();
      set({ addResult: passkeyCount, adding: false });
    } catch (e) {
      set({ addErr: e instanceof Error ? e.message : String(e), adding: false });
    }
  }

  function view(): Node {
    return Screen(
      { title: "Devices", onBack: () => ctx.go("account") },

      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Add a passkey (same device)"),
        el(
          "p",
          { style: { fontSize: "12px", color: "var(--text3)", margin: "0 0 10px" } },
          "Enrol another passkey for this wallet on THIS device (e.g. a second provider or a hardware key). It's a secondary — it can't derive your key by itself, so an encrypted copy is written on chain: one transaction, paid by the wallet.",
        ),
        Button({
          variant: "ghost",
          label: s.adding ? "Enrolling…" : "Add a passkey",
          disabled: s.adding,
          onClick: () => void handleAddPasskey(),
        }),
        // A LOCAL credential count — it cannot tell an access slot from an orphan (a credential whose slot
        // write never landed opens nothing). The honest "ways in" number is accessSlotCount(), on Access.
        s.addResult !== null &&
          el(
            "p",
            { style: { fontSize: "12px", marginTop: "8px", color: "var(--text2)" } },
            `Enrolled — ${s.addResult} credential(s) on this device. That is not the same as access slots; see “Who can reach this wallet” for the chain-verified count.`,
          ),
        s.addErr && el("p", { style: errText }, s.addErr),
      ),

      Card(
        null,
        el("div", { style: secLabel }, "Export to a device (cross device)"),
        el(
          "p",
          { style: { fontSize: "12px", color: "var(--text3)", margin: "0 0 14px", lineHeight: "1.5" } },
          "Provision this wallet onto a NEW device you own: it runs “Set up this device” and shows a QR — scan it here, then show it yours. You'll confirm a 6-digit code matches on both before anything is granted.",
        ),
        // This version cannot un-pair a device — not because removal is impossible, but because nothing
        // can tell you which slot belongs to which device. A user who is not told will assume otherwise.
        // Enrolling a passkey is a DEFERRED GRANT: the other device can obtain the wallet key whenever it
        // likes. Removing its access slot later is housekeeping (it frees capacity); it cannot un-learn a key
        // the passkey already had. Never imply removal undoes the grant.
        el(
          "p",
          { style: { fontSize: "12px", color: "var(--danger)", margin: "0 0 14px", lineHeight: "1.5" } },
          "⚠ This grants the other device the ability to use your wallet key — now, or at any time later. Only pair a device you control. You can remove its access slot afterwards (see “Who can reach this wallet”), but that only frees capacity: it cannot un-learn a key the device already had. If a device is lost or compromised, move your funds to a new wallet.",
        ),
        ceremonyNode,
      ),
    );
  }

  root.replaceChildren(view());
  return root;
}
