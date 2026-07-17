/**
 * Connect — framework-free port of react-shared-origin's Connect.tsx. The shared-origin
 * entry: "Continue with [operator]" runs the sign-in ceremony in the operator's
 * auth-origin popup; no key material crosses the boundary — only signatures come
 * back. Shared-origin is use-only: creating/managing a wallet happens at the
 * operator's own (Own-origin) app, linked via config.managementUrl.
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { BrandMark, Button, ErrorNote, Icon } from "../ui/index.js";

/** Operator name = the auth origin's host — never a hardcoded operator brand. */
function operatorName(authOrigin: string): string {
  try {
    return new URL(authOrigin).hostname;
  } catch {
    return authOrigin;
  }
}

export function Connect(ctx: Ctx): HTMLElement {
  const operator = operatorName(ctx.config.authOrigin);
  const root = el("div");
  let s = {
    pending: false,
    error: null as { kind: SendErrorKind; message: string } | null,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  async function handleContinue(): Promise<void> {
    set({ pending: true, error: null });
    try {
      await ctx.client.login();
      ctx.setAccount(ctx.client.account());
      ctx.go("home");
    } catch (e) {
      set({ pending: false, error: classifySendError(e) });
    }
  }

  function view(): Node {
    return el(
      "div",
      { style: { padding: "30px 22px 22px", textAlign: "center" } },
      el("div", { style: { display: "flex", justifyContent: "center", marginBottom: "16px" } }, BrandMark(50)),
      el(
        "h3",
        { style: { fontSize: "19px", fontWeight: "700", letterSpacing: "-.02em", color: "var(--text)", margin: "0 0 6px" } },
        `Continue with ${operator}`,
      ),
      el(
        "p",
        { style: { fontSize: "13px", color: "var(--text3)", lineHeight: "1.5", margin: "0 auto 20px", maxWidth: "32ch" } },
        `Sign in to ${operator} to use the same wallet here. Keys stay at ${operator} — this app only receives signatures.`,
      ),
      Button({
        variant: "primary",
        icon: Icon("external", 15),
        label: s.pending ? "Confirm in the popup…" : `Continue with ${operator}`,
        disabled: s.pending,
        onClick: () => void handleContinue(),
      }),
      s.error && el("div", { style: { marginTop: "10px" } }, ErrorNote(s.error)),

      el(
        "div",
        { style: { marginTop: "18px" } },
        Button({
          variant: "ghost",
          icon: Icon("external", 13),
          label: `New here? Set up at ${operator} ↗`,
          disabled: !ctx.config.managementUrl,
          onClick: () => {
            if (ctx.config.managementUrl) window.open(ctx.config.managementUrl, "_blank", "noopener");
          },
        }),
        el(
          "p",
          { style: { fontSize: "11.5px", color: "var(--text3)", lineHeight: "1.5", margin: "8px auto 0", maxWidth: "34ch" } },
          `Creating and managing a wallet happens in ${operator}'s own app — this app only signs in.`,
        ),
        !ctx.config.managementUrl &&
          el("p", { style: { fontSize: "11px", color: "var(--danger)", marginTop: "6px" } }, "Sign-up isn't currently available for this app."),
      ),

      el("div", { style: { fontSize: "11px", color: "var(--text3)", marginTop: "16px", fontFamily: "var(--font-mono)" } }, `Shared-origin · opens ${operator}`),
    );
  }

  root.replaceChildren(view());
  return root;
}
