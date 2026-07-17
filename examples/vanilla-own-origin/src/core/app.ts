/**
 * App shell + router — framework-free. Holds app-level state (nav, account) in
 * the reactive store; each screen owns its own local state. When there is no
 * account, the Onboard screen is shown; otherwise the primary nav bar
 * (Home · Send · Account) plus the active screen. Secondary screens (device,
 * access) render full-bleed with their own back affordance (no nav bar).
 */
import type { Account, FullAvokClient } from "@avokjs/vanilla";
import { el } from "./el.js";
import { createStore, type Store } from "./store.js";
import { config } from "../config.js";

export type Nav = "home" | "send" | "account" | "device" | "access";

export interface AppState {
  nav: Nav;
  account: Account | null;
}

// OWN-ORIGIN IS THE WALLET. It holds the key and renders its own consent (fee-bearing "sign what
// you saw"), so it drives the SDK's tx namespaces directly — NOT the provider (#4's two-product
// split; a shared-origin dapp does the opposite). #3 moved those engines behind
// sdk-core/internal and dropped `evm`/`solana` from the PUBLIC client type, but createAvokClient
// still returns them at runtime for own-origin apps. This structural view is how the demo reaches
// them, mirroring react-own-origin's Send screen. It is deliberately hand-written rather than
// imported from sdk-core/internal: an operator app should not reach into another package's
// internals, and this way the view states exactly what this demo depends on.
type EvmSim = { success: boolean; revertReason?: string; fee?: { feeToken: string; amount: bigint }; nativeFee?: { amount: bigint }; [k: string]: unknown };
// The Solana SELF-PAY estimate keeps a base/priority/rent split (SolanaNativeFeeEstimate); the
// FRONTED quote does not — Kora answers one all-in number (#5). Not the same animal.
type SolanaSim = { success: boolean; error?: string; fee?: { feeToken: string; amount: bigint }; nativeFee?: { baseFee: bigint; priorityFee: bigint; rent: bigint }; [k: string]: unknown };
type EvmToken = { address: string; symbol: string; decimals: number };
type SolanaToken = { mint: string; symbol: string; decimals: number };

export interface OwnOriginNamespaces {
  evm: {
    feeTokens(chainId: number): EvmToken[];
    simulate(calls: unknown[], opts: { chainId: number; feeToken: string | null }): Promise<EvmSim>;
    send(input: EvmSim | unknown[], opts: { chainId: number; feeToken: string | null }): Promise<{ id: string; txHash?: string }>;
    wait(receipt: { id: string; txHash?: string }): Promise<{ status: string; txHash?: string; error?: string }>;
    signMessage(a: { message: string }): Promise<`0x${string}`>;
  };
  solana: {
    feeTokens(cluster: string): SolanaToken[];
    supportedFeeTokens(cluster: string): Promise<SolanaToken[]>;
    simulate(ix: unknown[], opts: { cluster: string; feeToken: string | null }): Promise<SolanaSim>;
    send(input: SolanaSim | unknown[], opts: { cluster: string; feeToken: string | null }): Promise<{ id: string; signature?: string }>;
    wait(receipt: { id: string; signature?: string }): Promise<{ status: string; signature?: string; error?: string }>;
    signMessage(message: string): Promise<{ signature: string }>;
    buildSplTransfer(args: { mint: string; to: string; amount: bigint; cluster: string; feeToken: string | null }): Promise<unknown[]>;
  };
}

/** The own-origin client as this demo uses it: the public surface plus the runtime tx namespaces. */
export type OwnOriginClient = FullAvokClient & OwnOriginNamespaces;

export interface Ctx {
  client: OwnOriginClient;
  config: typeof config;
  store: Store<AppState>;
  /** Switch the active screen. */
  go: (nav: Nav) => void;
  /** Set (or clear) the active account, which flips Onboard ↔ app. */
  setAccount: (a: Account | null) => void;
  /** Re-read the current account from the client into the store. */
  refresh: () => void;
}

export type ScreenFn = (ctx: Ctx) => HTMLElement;

const PRIMARY: { id: Nav; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "send", label: "Send" },
  { id: "account", label: "Account" },
];

/**
 * Build the app Ctx (store + navigation helpers) around a ready client.
 *
 * Accepts the PUBLIC client type and widens it to OwnOriginClient at this one seam: the tx
 * namespaces exist at runtime but not on the public type (see the note above), so the cast is
 * stated once, here, instead of at every call site.
 */
export function createCtx(client: FullAvokClient): Ctx {
  const own = client as OwnOriginClient;
  const store = createStore<AppState>({ nav: "home", account: client.account() });
  return {
    client: own,
    config,
    store,
    go: (nav) => store.setState({ nav }),
    setAccount: (account) => store.setState({ account }),
    refresh: () => store.setState({ account: client.account() }),
  };
}

/** Mount the app into `root`, re-rendering on every store change. */
export function mountApp(
  root: HTMLElement,
  ctx: Ctx,
  screens: Record<Nav | "onboard", ScreenFn>,
): void {
  function navbar(active: Nav): HTMLElement {
    return el(
      "nav",
      { class: "navbar" },
      PRIMARY.map((n) =>
        el(
          "button",
          {
            class: `nav-btn${n.id === active ? " nav-active" : ""}`,
            onclick: () => ctx.go(n.id),
          },
          n.label,
        ),
      ),
    );
  }

  async function logout(): Promise<void> {
    await ctx.client.logout();
    ctx.setAccount(null);
    ctx.go("home");
  }

  function render(): void {
    const { nav, account } = ctx.store.getState();
    if (!account) {
      root.replaceChildren(screens.onboard(ctx));
      return;
    }
    const primary = nav === "home" || nav === "send" || nav === "account";
    const parts: Node[] = [];
    if (primary) parts.push(navbar(nav));
    parts.push(screens[nav](ctx));
    if (nav === "account") {
      parts.push(
        el(
          "div",
          { class: "shell-logout" },
          el("button", { class: "btn btn-ghost", onclick: logout }, "Log out"),
        ),
      );
    }
    root.replaceChildren(...parts);
  }

  ctx.store.subscribe(render);
  render();
}
