/**
 * Send — framework-free port of react-own-origin's Send.tsx. Rail toggle (EVM /
 * Solana), per-rail self-pay vs sponsored (sponsored gated + the sponsored-unavailable
 * copy when unconfigured), a "sign what you saw" consent review, then submit.
 *
 * Review SIMULATES, and Confirm sends THAT simulation — not a freshly built batch.
 * This demo used to skip the simulation and hand raw calls straight to `send()`, which
 * meant its consent screen could not show a fee AMOUNT at all: it named the rail and the
 * token and left the actual number blank. A consent screen with no number on it is not a
 * consent screen, and "it's only a demo" is how that ships. Simulating also makes the
 * signed bytes the bytes the user was shown.
 *
 * The tx FSM (`txReduce`) drives TxStatus + the explorer link; all failure paths
 * route through `classifySendError` → ErrorNote.
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { encodeFunctionData, erc20Abi, numberToHex, parseUnits, type Address, type Hex } from "viem";
import { getTransferSolInstruction } from "@solana-program/system";
import { getChain, chainName, solanaTokens, selectableChains } from "@avokjs/core/helpers";
import { solanaExplorerTxUrl } from "@avokjs/core/helpers";
import { formatAmount, txReduce, type TxState } from "@avokjs/core/helpers";
import { classifySendError, type SendErrorKind } from "@avokjs/core/helpers";
import { resolveRecipient } from "@avokjs/core/helpers";
import { resolver } from "../resolver.js";
import { config, hasEvmSponsored, hasSolanaSponsored, type SolanaCluster } from "../config.js";
import {
  Screen,
  Card,
  Field,
  AmountField,
  ConsentLines,
  TxStatus,
  ErrorNote,
  Button,
  ChainSwitcher,
  AddressText,
  Icon,
} from "../ui/index.js";

type Rail = "evm" | "solana";
type FeeMode = "self" | "sponsored";

/**
 * SHARED-ORIGIN IS A DAPP. It does not hold the wallet key and does not render the authoritative
 * consent — the wallet's sign popup does. So the EVM rail drives the STANDARD EIP-1193/5792 provider
 * (`wallet_sendCalls` → the popup shows the fee + calls; `wallet_getCallsStatus` tracks it), exactly as
 * any wagmi/viem dapp would. (Solana stays on the SDK until the Wallet Standard surface lands in #5.)
 * The wired client always announces this provider; it is narrowly typed on `Ctx`, hence the cast.
 */
type Eip1193Like = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type Eip5792CallsStatus = { status: number; receipts?: { status: Hex; transactionHash: Hex }[] };

type SolanaSim = Awaited<ReturnType<Ctx["client"]["solana"]["simulate"]>>;

/** SOL is 9-dec (lamports). A native asset's decimals are never the fee TOKEN's. */
const SOL_DECIMALS = 9;

const DEFAULT_EVM_CHAIN = selectableChains[0]?.id ?? 8453;
const CLUSTERS: SolanaCluster[] = ["devnet", "mainnet"];

const secLabel = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  color: "var(--text3)",
  marginBottom: "8px",
};

export function Send(ctx: Ctx): HTMLElement {
  const account = ctx.client.account();
  const root = el("div");
  let s = {
    rail: "evm" as Rail,
    // Shared-origin apps have no anchor — display-default is the first selectable chain.
    chainId: DEFAULT_EVM_CHAIN,
    cluster: "devnet" as SolanaCluster,
    tokenIdx: 0,
    feeMode: "self" as FeeMode,
    feeTokenIdx: 0,
    to: "",
    resolvedTo: null as string | null,
    resolvedFrom: null as string | null,
    amount: "",
    step: "form" as "form" | "review",
    // EVM goes through the provider (wallet_sendCalls); we hold the built calls, not a simulation —
    // the wallet popup owns the fee + consent. Solana keeps its app-side simulation.
    evmSendCalls: null as { to: Address; value: bigint; data: Hex }[] | null,
    solSim: null as SolanaSim | null,
    formError: null as string | null,
    txState: "idle" as TxState,
    err: null as { kind: SendErrorKind; message: string } | null,
    explorerUrl: undefined as string | undefined,
    /** What KORA accepts on this cluster (registry ∩ Kora), loaded async per cluster. */
    solFeeTokens: [] as { mint: string; symbol: string; decimals: number }[],
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  /**
   * Ask Kora which fee tokens it will accept on this cluster. Async, so the picker starts empty and
   * fills in — an unreachable Kora simply leaves it empty, which is the truth: nothing will front this
   * send, so the UI offers self-pay only.
   */
  let feeTokenLoad = 0;
  function loadSolanaFeeTokens(cluster: string) {
    const load = ++feeTokenLoad;
    if (!hasSolanaSponsored) {
      set({ solFeeTokens: [] });
      return;
    }
    void ctx.client.solana
      .supportedFeeTokens(cluster)
      .then((tokens) => {
        if (load === feeTokenLoad) set({ solFeeTokens: tokens });
      })
      .catch(() => {
        if (load === feeTokenLoad) set({ solFeeTokens: [] });
      });
  }
  loadSolanaFeeTokens(s.cluster);

  function derive() {
    const chain = s.rail === "evm" ? getChain(s.chainId) : undefined;
    const evmToken = chain?.tokens[s.tokenIdx];
    // Solana rail token list: native SOL first, then the cluster's registry SPL tokens. Reuses tokenIdx.
    const solTokens = solanaTokens(s.cluster);
    const solToken = solTokens[s.tokenIdx] ?? solTokens[0];
    const decimals = s.rail === "evm" ? (evmToken?.decimals ?? 18) : solToken.decimals;
    const symbol = s.rail === "evm" ? (evmToken?.symbol ?? "") : solToken.symbol;
    // Fee tokens are chain-specific ERC-20/SPL addresses — read them for the chain THIS transaction
    // executes on, never from a global env var. Sponsored needs the paymaster/bundler (EVM) or Kora
    // (Solana) URL AND at least one supported fee token on that chain. Solana asks KORA what it
    // accepts rather than offering the whole registry catalogue: a token the configured fee payer
    // refuses would fail at signing time for no reason the user could see.
    const sponsoredFeeTokens =
      s.rail === "evm"
        ? ctx.client.evm.feeTokens(s.chainId).map((t) => ({ key: t.address as string, symbol: t.symbol }))
        : s.solFeeTokens.map((t) => ({ key: t.mint, symbol: t.symbol }));
    const canSponsored = (s.rail === "evm" ? hasEvmSponsored : hasSolanaSponsored) && sponsoredFeeTokens.length > 0;
    const effectiveFeeMode: FeeMode = canSponsored ? s.feeMode : "self";
    const selectedFeeToken = effectiveFeeMode === "sponsored" ? (sponsoredFeeTokens[s.feeTokenIdx]?.key ?? null) : null;
    return {
      canSponsored,
      effectiveFeeMode,
      chain,
      evmToken,
      solTokens,
      solToken,
      decimals,
      symbol,
      sponsoredFeeTokens,
      selectedFeeToken,
    };
  }

  function amountBaseFor(decimals: number): bigint | null {
    try {
      return s.amount.trim() ? parseUnits(s.amount.replace(/,/g, ""), decimals) : null;
    } catch {
      return null;
    }
  }

  function switchRail(next: Rail): void {
    set({
      rail: next,
      step: "form",
      tokenIdx: 0,
      feeTokenIdx: 0,
      evmSendCalls: null,
      solSim: null,
      formError: null,
      err: null,
      resolvedTo: null,
      resolvedFrom: null,
      explorerUrl: undefined,
      txState: txReduce(s.txState, "reset"),
    });
  }

  async function handleReview(): Promise<void> {
    const { decimals, evmToken, selectedFeeToken } = derive();
    const amountBase = amountBaseFor(decimals);
    if (amountBase === null || amountBase <= 0n) {
      set({ formError: "Enter an amount greater than zero." });
      return;
    }
    if (s.rail === "evm" && !evmToken) {
      set({ formError: "No token configured on this chain." });
      return;
    }
    // Resolve the recipient — a raw address or any ENS/SNS name — into the address
    // we pass into the tx args (the app-wide resolve pattern).
    const rr = await resolveRecipient(resolver, s.to, s.rail);
    if ("error" in rr) {
      set({ formError: rr.error });
      return;
    }

    try {
      if (s.rail === "evm") {
        const { chain } = derive();
        if (!chain) return;
        // EVM is a provider (dapp) send: build the calls now and submit them via `wallet_sendCalls` on
        // Confirm. The wallet's sign popup simulates, shows the fee + calls, and enforces consent — the
        // dapp does not (and cannot) render the authoritative fee, so there is no app-side simulate.
        set({ evmSendCalls: evmCalls(rr.address, amountBase) });
      } else {
        // SIMULATE before consent. Solana still renders its own consent (the SDK path), so it needs the
        // fee + a revert check up front.
        const sim = await ctx.client.solana.simulate(await solanaIx(rr.address, amountBase), {
          cluster: s.cluster,
          feeToken: selectedFeeToken,
        });
        if (!sim.success) {
          set({ formError: sim.error ?? "Transaction would fail" });
          return;
        }
        set({ solSim: sim });
      }
    } catch (e) {
      set({ formError: classifySendError(e).message });
      return;
    }

    set({ formError: null, resolvedTo: rr.address, resolvedFrom: rr.resolvedFrom ?? null, step: "review" });
  }

  /** The EVM user calls — built once, so the simulated bytes and the signed bytes are the same bytes. */
  function evmCalls(toAddr: string, amountBase: bigint) {
    const { evmToken } = derive();
    return [
      {
        to: evmToken!.address,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [toAddr as Address, amountBase] }),
      },
    ];
  }

  /** The Solana instructions. Native SOL is a plain system transfer; an SPL token goes through the
   *  SDK, which owns the ATA + per-rail rent-payer logic. */
  async function solanaIx(toAddr: string, amountBase: bigint) {
    const { solToken } = derive();
    const account = ctx.client.account();
    if (!account) throw new Error("no account");
    if (solToken.mint === null) {
      return [
        getTransferSolInstruction({
          source: { address: account.solana.address } as never,
          destination: toAddr as never,
          amount: amountBase,
        }),
      ];
    }
    const { selectedFeeToken } = derive();
    return await ctx.client.solana.buildSplTransfer({
      mint: solToken.mint,
      to: toAddr,
      amount: amountBase,
      cluster: s.cluster,
      feeToken: selectedFeeToken,
    });
  }

  async function handleConfirm(): Promise<void> {
    const { chain, selectedFeeToken } = derive();
    if (!s.resolvedTo) return;
    set({ err: null, txState: txReduce(s.txState, "submit") });
    try {
      if (s.rail === "evm") {
        if (!chain || !s.evmSendCalls) return;
        // THE DAPP PATH. Submit through the standard EIP-5792 provider; the wallet's sign popup shows the
        // fee + calls and enforces "sign what you saw", then signs. A `paymasterService` capability
        // routes it sponsored (the wallet sponsors gas, the user repays in the chosen fee token).
        const provider = (ctx.client as unknown as { getEip1193Provider(): Eip1193Like }).getEip1193Provider();
        const from = ctx.client.account()?.evm.address as Address;
        const capabilities = selectedFeeToken
          ? { paymasterService: { url: config.paymasterUrl!, context: { token: selectedFeeToken } } }
          : undefined;
        const { id } = (await provider.request({
          method: "wallet_sendCalls",
          params: [
            {
              version: "2.0.0",
              from,
              chainId: numberToHex(chain.id),
              atomicRequired: false,
              calls: s.evmSendCalls.map((c) => ({ to: c.to, value: numberToHex(c.value), data: c.data })),
              ...(capabilities ? { capabilities } : {}),
            },
          ],
        })) as { id: string };
        const signed = txReduce(s.txState, "signed");
        set({ txState: signed });
        // Track via wallet_getCallsStatus until the bundle is included (5792 status 200) — NEVER round a
        // still-pending send up to success; the id is not a tx hash until a receipt carries one.
        const deadline = Date.now() + 90_000;
        let done: Eip5792CallsStatus | null = null;
        for (;;) {
          const st = (await provider.request({ method: "wallet_getCallsStatus", params: [id] })) as Eip5792CallsStatus;
          if (st.status === 200) {
            done = st;
            break;
          }
          if (Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        const receipt0 = done?.receipts?.[0];
        const txHash = receipt0?.transactionHash;
        set({
          txState: txReduce(signed, done && receipt0?.status === "0x1" ? "mined" : "revert"),
          ...(txHash ? { explorerUrl: chain.explorerTxUrl(txHash) } : {}),
          ...(done && receipt0?.status === "0x0"
            ? {
                err: {
                  kind: "sponsored-unavailable" as const,
                  message: "The transaction was included but reverted on-chain.",
                },
              }
            : !done
              ? {
                  err: {
                    kind: "unknown" as const,
                    message:
                      "The transaction was accepted but has not confirmed yet. Check the explorer before retrying — it may still land.",
                  },
                }
              : {}),
        });
      } else {
        if (!s.solSim) return;
        // Same rule on Solana: submit the simulated message, not a rebuilt one.
        const receipt = await ctx.client.solana.send(s.solSim, {
          cluster: s.cluster,
          feeToken: selectedFeeToken,
        });
        const signed = txReduce(s.txState, "signed");
        // Same rule as the EVM branch. A self-pay receipt is SUBMITTED (broadcast, not mined); a
        // sponsored receipt is PENDING, carries NO signature, and its `id` is the relayer's INTENT ID.
        // Linking that id produced an explorer page reading "Signature ... is not valid" underneath a
        // screen that said Confirmed. Never link an id; never claim a confirmation the chain has not
        // given.
        set({
          txState: signed,
          ...(receipt.signature ? { explorerUrl: solanaExplorerTxUrl(s.cluster, receipt.signature) } : {}),
        });
        const final = await ctx.client.solana.wait(receipt);
        set({
          txState: txReduce(signed, final.status === "confirmed" ? "mined" : "revert"),
          ...(final.signature ? { explorerUrl: solanaExplorerTxUrl(s.cluster, final.signature) } : {}),
          // A bare "Failed" is undiagnosable. The relayer tells us why it could not submit; show it.
          ...(final.status === "failed" && final.error
            ? {
                err: {
                  kind: "sponsored-unavailable" as const,
                  message: `The relayer could not submit this transaction: ${final.error}`,
                },
              }
            : final.status !== "confirmed" && final.status !== "failed"
              ? {
                  err: {
                    kind: "unknown" as const,
                    message:
                      final.status === "expired"
                        ? "The transaction's blockhash expired before it landed, so it can never confirm. It is safe to try again."
                        : "The transaction was accepted but has not confirmed yet. Check the explorer before retrying — it may still land.",
                  },
                }
              : {}),
        });
      }
    } catch (e) {
      set({ err: classifySendError(e), txState: txReduce(s.txState, "reject") });
    }
  }

  function startOver(): void {
    set({
      step: "form",
      evmSendCalls: null,
      solSim: null,
      formError: null,
      err: null,
      explorerUrl: undefined,
      txState: txReduce(s.txState, "reset"),
    });
  }

  /** SPONSORED fees are exact and signed. SELF-PAY fees are not: the chain charges at inclusion, so the
   *  number is an estimate — but an estimate is still a number, and the user is owed one. On the EVM
   *  (dapp/provider) rail the WALLET shows the authoritative fee in its popup, so this dapp doesn't. */
  function feeLabel(): string {
    const { symbol, solToken } = derive();
    if (s.rail === "evm") {
      // The dapp does not render the fee — the wallet's sign popup does (and enforces sign-what-you-saw).
      return "shown in your wallet when you confirm";
    }
    const sim = s.solSim;
    if (!sim) return "unavailable";
    if (sim.fee) {
      const p = ctx.client.solana.feeTokens(s.cluster).find((t) => t.mint === sim.fee!.feeToken);
      return `${formatAmount(sim.fee.amount, p?.decimals ?? 6)} ${p?.symbol ?? "token"}`;
    }
    if (sim.nativeFee) {
      const fee = `≈ ${formatAmount(sim.nativeFee.baseFee + sim.nativeFee.priorityFee, SOL_DECIMALS)} SOL (estimated)`;
      // Rent is NOT a fee: it funds the RECIPIENT's new token account and is refundable to them. At
      // ~0.00204 SOL it is hundreds of times the fee, so it is named, never folded in or left out.
      if (sim.nativeFee.rent > 0n) {
        return `${fee} + ${formatAmount(sim.nativeFee.rent, SOL_DECIMALS)} SOL deposit to open the recipient's ${solToken.symbol ?? symbol} account (refundable to them)`;
      }
      return fee;
    }
    return "unavailable";
  }

  function reviewView(): Node {
    const { chain, decimals, symbol, effectiveFeeMode, selectedFeeToken } = derive();
    const amountBase = amountBaseFor(decimals);
    // A consent screen is READ, not skimmed: plain facts, in the user's own units. No chain ids, no
    // token addresses, no gas units — a user cannot consent to what they cannot read.
    //
    // Resolve the fee symbol on the rail the transaction actually runs on. Searching only the EVM
    // chain's tokens left a Solana fee token unfound, so the consent screen printed its raw mint.
    const feeSymbol =
      effectiveFeeMode === "sponsored"
        ? s.rail === "solana"
          ? (ctx.client.solana.feeTokens(s.cluster).find((t) => t.mint === selectedFeeToken)?.symbol ?? "the fee token")
          : (chain?.tokens.find((t) => t.address.toLowerCase() === (selectedFeeToken ?? "").toLowerCase())?.symbol ??
            "the fee token")
        : s.rail === "evm"
          ? (chain?.nativeSymbol ?? "native")
          : "SOL";
    const lines = [
      s.rail === "evm" ? `Chain: ${chainName(s.chainId)}` : `Chain: Solana ${s.cluster}`,
      // The RECIPIENT belongs on a consent screen. This line used to name only the amount and the
      // token — the single field an attacker most wants swapped was the one field not shown.
      s.resolvedFrom
        ? `Send: ${s.amount} ${symbol} to ${s.resolvedFrom} (${s.resolvedTo})`
        : `Send: ${s.amount} ${symbol} to ${s.resolvedTo ?? s.to}`,
      effectiveFeeMode === "sponsored"
        ? `Fee mode: sponsored — the paymaster pays the network fee and you repay it in ${feeSymbol}`
        : `Fee mode: self-pay — you pay the network fee yourself, in ${feeSymbol} (this chain's native gas asset)`,
      `Transaction fee: ${feeLabel()}`,
    ];
    const done = s.txState === "confirmed" || s.txState === "failed";
    const busy = s.txState === "signing" || s.txState === "pending";
    return Screen(
      { title: "Confirm transfer" },
      ConsentLines({ lines }),
      el(
        "div",
        { style: { marginTop: "10px" } },
        el(
          "div",
          { style: { fontSize: "11px", color: "var(--text3)", marginBottom: "4px" } },
          s.resolvedFrom ? `Recipient (${s.resolvedFrom})` : "Recipient",
        ),
        AddressText({ address: s.resolvedTo ?? s.to, truncate: false, copy: true }),
      ),
      el("div", { style: { marginTop: "14px" } }, TxStatus({ state: s.txState, explorerUrl: s.explorerUrl })),
      s.err && el("div", { style: { marginTop: "10px" } }, ErrorNote(s.err)),
      el(
        "div",
        { style: { display: "flex", gap: "9px", marginTop: "14px" } },
        done
          ? Button({ variant: "primary", label: "Send another", onClick: startOver })
          : el(
              "div",
              { style: { display: "flex", gap: "9px" } },
              Button({ variant: "ghost", label: "Reject", disabled: busy, onClick: () => set({ step: "form" }) }),
              Button({
                variant: "primary",
                icon: Icon("passkey", 15),
                label: s.txState === "signing" ? "Signing…" : "Confirm",
                disabled: busy,
                onClick: () => void handleConfirm(),
              }),
            ),
      ),
    );
  }

  function formView(): Node {
    const { canSponsored, effectiveFeeMode, chain, symbol, sponsoredFeeTokens, solTokens } = derive();
    const multiToken = s.rail === "evm" && !!chain && chain.tokens.length > 1;
    const solMultiToken = s.rail === "solana" && solTokens.length > 1;
    return Screen(
      { title: "Send" },
      el(
        "div",
        { style: { marginBottom: "14px" } },
        ChainSwitcher({
          chains: [...selectableChains.map((c) => ({ id: c.id, name: c.name })), { id: -1, name: "Solana" }],
          selected: s.rail === "evm" ? s.chainId : -1,
          onSelect: (id) => {
            if (id === -1) switchRail("solana");
            else
              set({
                rail: "evm",
                chainId: id,
                tokenIdx: 0,
                feeTokenIdx: 0,
                step: "form",
                formError: null,
                err: null,
                explorerUrl: undefined,
                txState: txReduce(s.txState, "reset"),
              });
          },
        }),
      ),

      // Solana cluster picker (devnet / mainnet) — the SDK targets it per call.
      s.rail === "solana" &&
        Card(
          { style: { marginBottom: "14px" } },
          el("div", { style: secLabel }, "Cluster"),
          el(
            "div",
            { style: { display: "flex", gap: "8px" } },
            ...CLUSTERS.map((c) =>
              Button({
                variant: s.cluster === c ? "primary" : "ghost",
                label: c === "mainnet" ? "Mainnet" : "Devnet",
                onClick: () => {
                  set({ cluster: c, feeTokenIdx: 0, tokenIdx: 0 });
                  loadSolanaFeeTokens(c);
                },
              }),
            ),
          ),
        ),

      Field({
        label: "To",
        value: s.to,
        placeholder:
          s.rail === "evm" ? "0x… address or name (e.g. alice.eth)" : "Solana address or name (e.g. alice.sol)",
        onChange: (v) => {
          s.to = v;
          s.resolvedTo = null;
          s.resolvedFrom = null;
        },
      }),

      AmountField({
        value: s.amount,
        token: multiToken ? `${symbol} ▾` : symbol,
        onChange: (v) => {
          s.amount = v;
        },
      }),
      multiToken &&
        chain &&
        el(
          "div",
          { style: { marginBottom: "14px" } },
          Button({
            variant: "ghost",
            label: `◆ ${chainName(s.chainId)} · ${symbol}`,
            onClick: () => set({ tokenIdx: (s.tokenIdx + 1) % chain.tokens.length }),
          }),
        ),
      solMultiToken &&
        el(
          "div",
          { style: { marginBottom: "14px" } },
          Button({
            variant: "ghost",
            label: `◎ Solana ${s.cluster} · ${symbol}`,
            onClick: () => set({ tokenIdx: (s.tokenIdx + 1) % solTokens.length }),
          }),
        ),

      Card(
        { style: { marginBottom: "14px" } },
        el("div", { style: secLabel }, "Fee mode"),
        el(
          "div",
          { style: { display: "flex", gap: "8px" } },
          Button({
            variant: effectiveFeeMode === "self" ? "primary" : "ghost",
            label: "Self-pay",
            onClick: () => set({ feeMode: "self" }),
          }),
          Button({
            variant: effectiveFeeMode === "sponsored" ? "primary" : "ghost",
            label: "Sponsored",
            disabled: !canSponsored,
            onClick: () => set({ feeMode: "sponsored" }),
          }),
        ),
        effectiveFeeMode === "sponsored" &&
          sponsoredFeeTokens.length > 0 &&
          el(
            "div",
            { style: { marginTop: "10px" } },
            el("div", { style: secLabel }, "Fee token"),
            el(
              "div",
              { style: { display: "flex", gap: "8px" } },
              ...sponsoredFeeTokens.map((t, i) =>
                Button({
                  variant: s.feeTokenIdx === i ? "primary" : "ghost",
                  label: t.symbol,
                  onClick: () => set({ feeTokenIdx: i }),
                }),
              ),
            ),
          ),
        !canSponsored &&
          el(
            "div",
            { style: { fontSize: "11px", marginTop: "8px", color: "var(--text3)" } },
            s.rail === "evm"
              ? hasEvmSponsored
                ? "Sponsored unavailable — no supported fee token on this chain."
                : "Sponsored (sponsored) sends aren't available for this app."
              : hasSolanaSponsored
                ? "Sponsored unavailable — no supported fee token on this cluster."
                : "Sponsored (sponsored) sends aren't available for this app.",
          ),
      ),

      s.formError &&
        el("div", { style: { marginBottom: "10px" } }, ErrorNote({ kind: "unknown", message: s.formError })),

      Button({ variant: "primary", label: "Review transfer", onClick: () => void handleReview() }),
    );
  }

  function view(): Node {
    if (!account) return el("div");
    return s.step === "review" ? reviewView() : formView();
  }

  root.replaceChildren(view());
  return root;
}
