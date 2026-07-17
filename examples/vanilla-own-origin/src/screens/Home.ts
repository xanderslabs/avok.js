/**
 * Home — identity header, chain switcher, and app-side balances (framework-free
 * port of react-own-origin's Home.tsx). The SDK is headless on balances, so the demo
 * reads them via @avokjs/helpers (viem for EVM, @solana/kit for Solana).
 * The EVM home-base defaults to the anchor chain; the Solana card has a
 * devnet/mainnet cluster toggle (both reachable).
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { selectableChains, chainName } from "@avokjs/helpers";
import { readBalances, readSolanaBalances, type TokenBalance } from "@avokjs/helpers";
import { config, type SolanaCluster } from "../config.js";
import { Card, ChainSwitcher, TokenRow, AddressText, EmptyState, Button, Icon } from "../ui/index.js";

const DEFAULT_CHAIN = selectableChains[0]?.id ?? 8453;
const CLUSTERS: SolanaCluster[] = ["devnet", "mainnet"];

const secLabel = { fontSize: "11px", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text3)", marginBottom: "8px" };

export function Home(ctx: Ctx): HTMLElement {
  const account = ctx.client.account();
  const root = el("div");
  let s = {
    // Home-base display defaults to the ANCHOR chain (where this wallet anchors its access slots).
    chainId: selectableChains.find((c) => c.id === ctx.config.anchorChainNumeric)?.id ?? DEFAULT_CHAIN,
    cluster: "devnet" as SolanaCluster,
    balances: null as TokenBalance[] | null,
    solBalances: null as TokenBalance[] | null,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  // Race guard: only the latest EVM load may commit its result.
  let evmGen = 0;
  function loadEvm(chainId: number): void {
    if (!account) return;
    const gen = ++evmGen;
    set({ chainId, balances: null });
    readBalances(chainId, account.evm.address, config.rpcUrls)
      .then((b) => gen === evmGen && set({ balances: b }))
      .catch(() => gen === evmGen && set({ balances: [] }));
  }

  // Race guard: only the latest Solana load may commit (cluster can change mid-flight).
  let solGen = 0;
  function loadSolana(cluster: SolanaCluster): void {
    if (!account) return;
    const gen = ++solGen;
    set({ cluster, solBalances: null });
    readSolanaBalances(cluster, account.solana.address, config.rpcUrls)
      .then((b) => gen === solGen && set({ solBalances: b }))
      .catch(() => gen === solGen && set({ solBalances: [] }));
  }

  function view(): Node {
    if (!account) return EmptyState(null, "Sign in to see your balances.");

    const { chainId, cluster, balances, solBalances } = s;

    return el(
      "div",
      { style: { padding: "18px 16px 20px" } },

      // Identity
      el(
        "div",
        { style: { marginBottom: "18px" } },
        el("div", { style: { fontSize: "15px", fontWeight: "600", color: "var(--text)", marginBottom: "8px" } }, "Your wallet"),
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" } },
          el("span", { style: { fontSize: "11px", color: "var(--text3)", width: "46px" } }, "EVM"),
          AddressText({ address: account.evm.address, copy: true }),
        ),
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px" } },
          el("span", { style: { fontSize: "11px", color: "var(--text3)", width: "46px" } }, "Solana"),
          AddressText({ address: account.solana.address, copy: true }),
        ),
      ),

      // EVM balances
      Card(
        { style: { marginBottom: "16px" } },
        el(
          "div",
          { style: { marginBottom: "12px" } },
          ChainSwitcher({
            chains: selectableChains.map((c) => ({ id: c.id, name: c.name })),
            selected: chainId,
            onSelect: (id) => loadEvm(id),
          }),
        ),
        balances === null
          ? EmptyState({ loading: true })
          : balances.length === 0
            ? EmptyState(null, `Could not load balances for ${chainName(chainId)}.`)
            : el(
                "div",
                null,
                balances.map((b, i) =>
                  TokenRow({
                    symbol: b.symbol,
                    name: b.symbol,
                    chain: chainName(chainId),
                    amount: b.formatted,
                    glyph: b.address === null ? "◆" : b.symbol.slice(0, 1),
                    first: i === 0,
                  }),
                ),
              ),
      ),

      // Solana — pick the cluster (devnet / mainnet); the SDK targets it per call.
      Card(
        { style: { marginBottom: "16px" } },
        el(
          "div",
          { style: { marginBottom: "12px" } },
          ChainSwitcher({
            chains: CLUSTERS.map((c) => ({ id: c === "mainnet" ? 1 : 0, name: c === "mainnet" ? "Solana Mainnet" : "Solana Devnet" })),
            selected: cluster === "mainnet" ? 1 : 0,
            onSelect: (id) => loadSolana(id === 1 ? "mainnet" : "devnet"),
          }),
        ),
        solBalances === null
          ? EmptyState({ loading: true })
          : solBalances.length === 0
            ? EmptyState(null, "Could not load Solana balances.")
            : el(
                "div",
                null,
                solBalances.map((b, i) =>
                  TokenRow({
                    symbol: b.symbol,
                    name: b.symbol,
                    chain: `Solana ${cluster}`,
                    amount: b.formatted,
                    glyph: b.symbol === "SOL" ? "◎" : b.symbol.slice(0, 1),
                    first: i === 0,
                  }),
                ),
              ),
      ),

      Button({ variant: "primary", icon: Icon("send", 15), label: "Send", onClick: () => ctx.go("send") }),
    );
  }

  root.replaceChildren(view());
  // Kick off the balance reads after first paint (loading states show meanwhile).
  loadEvm(s.chainId);
  loadSolana(s.cluster);
  return root;
}
