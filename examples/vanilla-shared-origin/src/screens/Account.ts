/**
 * Account — framework-free port of react-shared-origin's Account.tsx. Use-only
 * surface: identity, a link out to the operator's management app, a sign-message
 * tool (EVM + Solana), resolve-only name lookup, and disconnect. There is NO
 * export/access-slot/passkey/register/pairing here — the wallet's keys live at the
 * operator origin; those actions happen at the operator's own own-origin app.
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { resolver } from "../resolver.js";
import { Screen, Card, Field, Button, AddressText, ErrorNote } from "../ui/index.js";

type Err = { kind: SendErrorKind; message: string } | null;
const secLabel = { fontSize: "11px", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text3)", marginBottom: "10px" };

/** Operator name = the auth origin's host — never a hardcoded operator brand. */
function operatorName(authOrigin: string): string {
  try {
    return new URL(authOrigin).hostname;
  } catch {
    return authOrigin;
  }
}

export function Account(ctx: Ctx): HTMLElement {
  const account = ctx.client.account();
  const operator = operatorName(ctx.config.authOrigin);
  const root = el("div");
  let s = {
    message: "Hello from Avok demo",
    evmSig: null as string | null,
    solSig: null as string | null,
    signErr: null as Err,
    evmSigning: false,
    solSigning: false,
    lookup: "",
    resolved: undefined as { evm?: string; solana?: string } | null | undefined,
    resolving: false,
    resolveErr: null as Err,
    loggingOut: false,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

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

  async function handleResolve(): Promise<void> {
    set({ resolveErr: null, resolved: undefined, resolving: true });
    try {
      // Any ENS/SNS name → address(es) via the SDK facade (.sol→SNS, else→ENS).
      set({ resolved: await resolver.resolveForward(s.lookup.trim()), resolving: false });
    } catch (e) {
      set({ resolveErr: classifySendError(e), resolving: false });
    }
  }

  async function handleDisconnect(): Promise<void> {
    set({ loggingOut: true });
    try {
      await ctx.client.logout();
      ctx.setAccount(null);
      ctx.go("home");
    } catch {
      set({ loggingOut: false });
    }
  }

  function view(): Node {
    if (!account) return el("div");

    return Screen(
      { title: "Account" },
      el("p", { style: { fontSize: "12px", color: "var(--text3)", marginBottom: "14px" } }, "Managed by ", el("b", null, operator), " — export, access slots, and device management happen at the operator's app, not here."),

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

      // Wallet management — at the operator's app
      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Wallet management"),
        ctx.config.managementUrl
          ? el(
              "div",
              null,
              el("p", { style: { fontSize: "12px", marginBottom: "10px", color: "var(--text2)" } }, `Add devices or export at ${operator}.`),
              Button({ variant: "ghost", label: `Manage at ${operator}`, onClick: () => window.open(ctx.config.managementUrl, "_blank", "noopener") }),
            )
          : el(
              "p",
              { style: { fontSize: "12px", color: "var(--text2)" } },
              "Wallet management isn't currently configured for this app.",
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

      // Subname resolve (use-only: no register/mint)
      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Look up a name"),
        Field({
          label: "Name",
          value: s.lookup,
          placeholder: "e.g. ada.avok.eth or alice.sol",
          onChange: (v) => {
            s.lookup = v;
          },
        }),
        Button({ variant: "ghost", label: s.resolving ? "Resolving…" : "Resolve", disabled: s.resolving, onClick: () => void handleResolve() }),
        s.resolved !== undefined &&
          el(
            "div",
            { style: { marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" } },
            s.resolved?.evm &&
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "6px" } },
                el("span", { style: { fontSize: "11px", width: "46px", color: "var(--text3)" } }, "EVM"),
                AddressText({ address: s.resolved.evm, truncate: false, copy: true }),
              ),
            s.resolved?.solana &&
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "6px" } },
                el("span", { style: { fontSize: "11px", width: "46px", color: "var(--text3)" } }, "Solana"),
                AddressText({ address: s.resolved.solana, truncate: false, copy: true }),
              ),
            (!s.resolved || (!s.resolved.evm && !s.resolved.solana)) &&
              el("p", { style: { fontSize: "12px", margin: "0", color: "var(--text2)" } }, "No address found."),
          ),
        s.resolveErr && el("div", { style: { marginTop: "8px" } }, ErrorNote(s.resolveErr)),
      ),

      // Disconnect
      Card(
        null,
        Button({ variant: "ghost", label: s.loggingOut ? "Disconnecting…" : "Disconnect", disabled: s.loggingOut, onClick: () => void handleDisconnect() }),
      ),
    );
  }

  root.replaceChildren(view());
  return root;
}
