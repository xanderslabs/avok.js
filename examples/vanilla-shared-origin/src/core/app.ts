/**
 * App shell + router — framework-free, SHARED-ORIGIN (use-only) variant. The client
 * is a UseOnlyAvokClient: the wallet's keys live at the operator origin, so this
 * app has no create/import/export/access-slot/pairing/device screens. When there is
 * no session, the Connect screen is shown; otherwise the primary nav bar
 * (Home · Send · Account) plus the active screen. Disconnect lives in Account
 * (not the shell), mirroring react-shared-origin.
 */
import type { Account, UseOnlyAvokClient } from "@avokjs/core";
import { el } from "./el.js";
import { createStore, type Store } from "./store.js";
import { config } from "../config.js";

export type Nav = "home" | "send" | "account";

export interface AppState {
  nav: Nav;
  account: Account | null;
}

// The tx namespaces exist at RUNTIME on a shared-origin client (every verb is a round-trip to the
// auth-origin popup, which runs the gesture) but #3 dropped `evm`/`solana` from the PUBLIC client
// type. This structural view is how the demo reaches them — stated once here rather than cast at
// every call site, and hand-written rather than imported from sdk-core/internal: an operator app
// should not reach into another package's internals. Mirrors vanilla-own-origin's OwnOriginClient.
type EvmSim = { success: boolean; revertReason?: string; fee?: { feeToken: string; amount: bigint }; nativeFee?: { amount: bigint }; [k: string]: unknown };
// The Solana SELF-PAY estimate keeps a base/priority/rent split; the SPONSORED quote does not —
// Kora answers one all-in number (#5). Not the same animal.
type SolanaSim = { success: boolean; error?: string; fee?: { feeToken: string; amount: bigint }; nativeFee?: { baseFee: bigint; priorityFee: bigint; rent: bigint }; [k: string]: unknown };
type EvmToken = { address: string; symbol: string; decimals: number };
type SolanaToken = { mint: string; symbol: string; decimals: number };

export interface SharedOriginNamespaces {
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

/** The shared-origin client as this demo uses it: the public surface plus the runtime tx namespaces. */
export type SharedOriginClient = UseOnlyAvokClient & SharedOriginNamespaces;

export interface Ctx {
  client: SharedOriginClient;
  config: typeof config;
  store: Store<AppState>;
  /** Switch the active screen. */
  go: (nav: Nav) => void;
  /** Set (or clear) the active session, which flips Connect ↔ app. */
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

/** Build the app Ctx (store + navigation helpers) around a ready shared-origin client. */
export function createCtx(client: UseOnlyAvokClient): Ctx {
  // Widen at this ONE seam (see the note above), not at every call site.
  const c = client as SharedOriginClient;
  const store = createStore<AppState>({ nav: "home", account: client.account() });
  return {
    client: c,
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
  screens: Record<Nav | "connect", ScreenFn>,
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

  function render(): void {
    const { nav, account } = ctx.store.getState();
    if (!account) {
      root.replaceChildren(screens.connect(ctx));
      return;
    }
    root.replaceChildren(navbar(nav), screens[nav](ctx));
  }

  ctx.store.subscribe(render);
  render();
}
