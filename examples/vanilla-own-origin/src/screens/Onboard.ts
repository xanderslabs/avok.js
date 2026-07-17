/**
 * Onboard — shown while there's no account (framework-free port of react-own-origin's Onboard.tsx).
 *
 * The user is never asked to reason about credentials. They answer one question — do I have a
 * wallet, or not — and, if they do, one follow-up: is it available here?
 *
 *  - RETURNING (a wallet was established in this browser before) → "Sign in". One button.
 *  - COLD → two options: "Create a wallet" (a fresh credential mints a NEW, separate wallet) or
 *    "Use an existing wallet", which branches:
 *      · "Open it"                       → continue(); the credential is already available here
 *                                          (synced, or this device was set up earlier). Derives the
 *                                          key from the credential itself — no network call.
 *      · "Set it up from another device" → the enroller half of the two-party ceremony, for when
 *                                          the credential does NOT sync here. This MUST live at
 *                                          sign-in: a device with no wallet has no settings screen
 *                                          to host it. The GRANTING half ("Export to a device")
 *                                          lives in settings, on the live wallet. It costs one
 *                                          funded transaction, so the warning is shown up front,
 *                                          before the final step mints this device's credential.
 *
 * Create/Open populate the account via the client; the shell flips to the primary nav once
 * `ctx.setAccount` resolves. There is no import: with no seed to type in, there's nothing to import.
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { BrandMark, Button, Card, ErrorNote, Icon, Screen } from "../ui/index.js";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { Ceremony } from "../pairing/ceremony.js";
import { isReturning, markReturning } from "../returning.js";

type Busy = "create" | "continue" | null;
type View = "signin" | "cold" | "existing" | "setup";

export function Onboard(ctx: Ctx): HTMLElement {
  const root = el("div");
  // Built once when the user enters the setup view — the ceremony starts on construction, so it must
  // never be recreated by a re-render.
  let ceremonyNode: HTMLElement | null = null;
  let s = {
    view: (isReturning() ? "signin" : "cold") as View,
    busy: null as Busy,
    error: null as { kind: SendErrorKind; message: string } | null,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  async function run(kind: Exclude<Busy, null>, op: () => Promise<{ evm: unknown }>): Promise<void> {
    set({ busy: kind, error: null });
    try {
      const account = (await op()) as import("@avokjs/vanilla").Account;
      markReturning();
      ctx.setAccount(account);
      ctx.go("home");
    } catch (e) {
      set({ busy: null, error: classifySendError(e) });
    }
  }

  function beginSetup(): void {
    ceremonyNode = Ceremony({
      role: "import",
      pairing: ctx.client.enrollAccessSlot.viaPairing,
      doneText:
        "This device is set up. Your wallet key never left your other device — this device got its own encrypted copy, written on chain, and that copy is what lets it sign in from now on, including after a reload.",
      onComplete: () => {
        // The enroller was handed NO key, so it is not logged in yet: it signs in the ordinary way, by
        // reading the blob the holder just wrote and decrypting it with this device's own credential.
        // That read is why we call login() here rather than receiving an account from the ceremony.
        void ctx.client
          .login()
          .then((account) => {
            markReturning();
            ctx.setAccount(account);
            ctx.go("home");
          })
          .catch((e: unknown) => {
            // The commonest cause is benign: the other device's write has not been mined yet. Retrying
            // is the fix — this is NOT "your wallet is gone".
            alert(`Could not sign in yet — has the other device finished? ${String(e)}`);
          });
      },
    });
    set({ view: "setup" });
  }

  function setupView(): Node {
    return Screen(
      { title: "Set up this device", onBack: () => set({ view: "existing" }) },
      el(
        "p",
        { style: { fontSize: "12px", color: "var(--text3)", margin: "0 0 12px", lineHeight: "1.5" } },
        "Bring your wallet to this device from the one that already has it. This is the new-device half of a two-part flow: on your other device open Settings → “Export to a device”, then follow along here. The codes travel as QR — you'll show one and scan theirs — and you compare a 6-digit code on both screens before anything is granted.",
      ),
      Card(
        { style: { marginBottom: "14px" } },
        el(
          "p",
          { style: { fontSize: "12px", color: "var(--text2)", margin: "0", lineHeight: "1.55" } },
          "This costs one on-chain transaction, paid by the wallet: this device gets its own encrypted key copy stored on chain, and that copy is what lets it sign in later. A wallet with no funds can't add a device yet.",
        ),
      ),
      ceremonyNode ?? el("span"),
    );
  }

  function existingView(): Node {
    const busy = s.busy;
    return Screen(
      { title: "Use an existing wallet", onBack: () => set({ view: "cold" }) },
      el(
        "p",
        { style: { fontSize: "13px", color: "var(--text3)", margin: "0 0 16px", lineHeight: "1.5" } },
        "Is your wallet already available on this device?",
      ),
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "9px" } },
        Button({
          variant: "primary",
          label: busy === "continue" ? "Signing in…" : "Open it",
          disabled: busy !== null,
          onClick: () => void run("continue", () => ctx.client.login()),
        }),
        Button({
          variant: "ghost",
          icon: Icon("device", 15),
          label: "Set it up from another device",
          disabled: busy !== null,
          onClick: () => beginSetup(),
        }),
      ),
      el(
        "p",
        { style: { fontSize: "11px", color: "var(--text3)", margin: "12px auto 0", maxWidth: "34ch", lineHeight: "1.5" } },
        "Setting it up from another device costs one on-chain transaction, paid by the wallet.",
      ),
      s.error && el("div", { style: { marginTop: "14px" } }, ErrorNote(s.error)),
    );
  }

  function signinView(): Node {
    const busy = s.busy;
    return el(
      "div",
      { style: { padding: "30px 22px 22px", textAlign: "center" } },
      el("div", { style: { display: "flex", justifyContent: "center", marginBottom: "16px" } }, BrandMark(50)),
      el(
        "h3",
        { style: { fontSize: "19px", fontWeight: "700", letterSpacing: "-.02em", color: "var(--text)", margin: "0 0 6px" } },
        "Welcome back",
      ),
      el(
        "p",
        {
          style: {
            fontSize: "13px",
            color: "var(--text3)",
            lineHeight: "1.5",
            margin: "0 auto 20px",
            maxWidth: "32ch",
          },
        },
        "Your wallet is on this device. Sign in to open it.",
      ),
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "9px" } },
        Button({
          variant: "primary",
          label: busy === "continue" ? "Signing in…" : "Sign in",
          disabled: busy !== null,
          onClick: () => void run("continue", () => ctx.client.login()),
        }),
        Button({
          variant: "ghost",
          label: "Use a different wallet",
          disabled: busy !== null,
          onClick: () => set({ view: "cold" }),
        }),
      ),
      s.error && el("div", { style: { marginTop: "14px" } }, ErrorNote(s.error)),
    );
  }

  function coldView(): Node {
    const busy = s.busy;
    return el(
      "div",
      { style: { padding: "30px 22px 22px", textAlign: "center" } },
      el("div", { style: { display: "flex", justifyContent: "center", marginBottom: "16px" } }, BrandMark(50)),
      el(
        "h3",
        { style: { fontSize: "19px", fontWeight: "700", letterSpacing: "-.02em", color: "var(--text)", margin: "0 0 6px" } },
        "Welcome to Avok",
      ),
      el(
        "p",
        {
          style: {
            fontSize: "13px",
            color: "var(--text3)",
            lineHeight: "1.5",
            margin: "0 auto 20px",
            maxWidth: "32ch",
          },
        },
        "Keys live on this device — no custodian holds your funds.",
      ),

      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "9px" } },
        Button({
          variant: "primary",
          icon: Icon("plus", 15),
          label: busy === "create" ? "Creating your wallet…" : "Create a wallet",
          disabled: busy !== null,
          onClick: () => void run("create", () => ctx.client.create()),
        }),
        Button({
          variant: "ghost",
          label: "Use an existing wallet",
          disabled: busy !== null,
          onClick: () => set({ view: "existing" }),
        }),
      ),

      el(
        "p",
        { style: { fontSize: "11px", color: "var(--text3)", margin: "12px auto 0", maxWidth: "34ch", lineHeight: "1.5" } },
        "Create makes a new, separate wallet.",
      ),

      s.error && el("div", { style: { marginTop: "14px" } }, ErrorNote(s.error)),
    );
  }

  function view(): Node {
    if (s.view === "setup") return setupView();
    if (s.view === "existing") return existingView();
    if (s.view === "signin") return signinView();
    return coldView();
  }

  root.replaceChildren(view());
  return root;
}
