/**
 * App bootstrap — SHARED-ORIGIN (use-only). The connection is built asynchronously:
 * createSharedOriginConnection dynamically imports @avokjs/network (bundle
 * purity), so this shows a "Connecting…" state, then mounts on success or an
 * error state if the operator's auth origin can't be reached. The wallet's keys
 * live at config.authOrigin; signing happens in its popup — only signatures
 * cross back. Reads src/config.ts only, so the app clones cleanly.
 */
import "./theme/tokens.css";
import "./ui/ui.css";

import { createAvokClient, createSharedOriginConnection } from "@avokjs/vanilla";
import type { UseOnlyAvokClient } from "@avokjs/vanilla";
import { el } from "./core/el.js";
import { config } from "./config.js";
import { createCtx, mountApp } from "./core/app.js";
import { Connect } from "./screens/Connect.js";
import { Home } from "./screens/Home.js";
import { Send } from "./screens/Send.js";
import { Account } from "./screens/Account.js";

function operatorName(authOrigin: string): string {
  try {
    return new URL(authOrigin).hostname;
  } catch {
    return authOrigin;
  }
}

const root = document.getElementById("app")!;
const operator = operatorName(config.authOrigin);

/**
 * `envHint` is shown ONLY when reaching the auth origin is what actually failed. This used to be a
 * single catch around all of boot(), so EVERY startup error — a bad session, a client bug, a throw
 * inside mountApp — was reported as "Couldn't reach the auth origin. Set VITE_AUTH_ORIGIN", naming
 * a variable that was perfectly correct and sending you to debug the wrong thing entirely.
 */
function renderError(title: string, message: string, envHint: boolean): void {
  root.replaceChildren(
    el(
      "div",
      { style: { padding: "24px" } },
      el("p", { style: { color: "var(--danger)", fontSize: "13px", margin: "0" } }, title),
      el("p", { style: { color: "var(--text3)", fontSize: "12px", marginTop: "6px" } }, message),
      ...(envHint
        ? [
            el(
              "p",
              { style: { color: "var(--text3)", fontSize: "12px", marginTop: "6px" } },
              "Set ",
              el("code", null, "VITE_AUTH_ORIGIN"),
              " to the operator's auth origin in your ",
              el("code", null, ".env"),
              ".",
            ),
          ]
        : []),
    ),
  );
}

async function boot(): Promise<void> {
  root.replaceChildren(el("div", { style: { padding: "24px", color: "var(--text3)" } }, `Connecting to ${operator}…`));

  let connection: Awaited<ReturnType<typeof createSharedOriginConnection>>;
  try {
    connection = await createSharedOriginConnection({
      authOrigin: config.authOrigin,
    });
  } catch (e) {
    // This one really IS about the auth origin: it fetches the operator's OIDC discovery document.
    renderError(`Couldn't reach ${operator}.`, e instanceof Error ? e.message : String(e), true);
    return;
  }

  try {
    const client = createAvokClient({
      connection,
      rpcUrls: config.rpcUrls,
      paymasterUrl: config.paymasterUrl,
      bundlerUrl: config.bundlerUrl,
      koraUrl: config.koraUrl,
      subnameRegistrar: config.subname.registrar,
      subnameParent: config.subname.parent,
      managementUrl: config.managementUrl,
    }) as UseOnlyAvokClient;

    const ctx = createCtx(client);
    mountApp(root, ctx, { connect: Connect, home: Home, send: Send, account: Account });
  } catch (e) {
    renderError("Something went wrong starting the app.", e instanceof Error ? e.message : String(e), false);
  }
}

void boot();
