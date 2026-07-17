/**
 * Subname — framework-free port of react-own-origin's Subname.tsx.
 *
 * #6 — SUBNAMES ARE AN OPTIONAL ADD-ON. The core client has no subname verbs at all: this screen
 * BUILDS the mint with @avokjs/subnames and sends the calls itself. Uninstall the add-on and
 * only this screen breaks; the wallet keeps working, and name RESOLUTION (../resolver.ts, from
 * @avokjs/helpers) keeps working too.
 *
 * Own-origin sends via the SDK, not the provider (#4's two-product split): this app IS the wallet
 * and renders its own fee-bearing consent. A dapp would send the very same calls through the
 * provider's wallet_sendCalls instead — the add-on neither knows nor cares. It only builds.
 *
 * An ENS / SNS toggle picks the name service: ENS (live `fullName` preview → availability + mint
 * fee → mint), SNS (.sol, mint-on-submit). Both drive the tx FSM with an explorer link, and each
 * side is gated on its own VITE_SUBNAME_* / VITE_SNS_* config.
 */
import { el } from "../core/el.js";
import type { Ctx } from "../core/app.js";
import { fullName } from "@avokjs/helpers";
import {
  buildSubnameMintCalls,
  buildSnsMintIx,
  createEnsRegistrar,
  readMintFee,
  ENS_SUBNAME_CHAIN_ID,
} from "@avokjs/subnames";
import { createSubRegistrarRegister } from "@avokjs/subnames/sns";
import { createSolanaRpc } from "@solana/kit";
import { solanaRpcUrl } from "@avokjs/contracts";
import { resolver, ensPublicClient, SNS_CLUSTER } from "../resolver.js";
import { type Address } from "viem";
import { getChain } from "@avokjs/helpers";
import { solanaExplorerTxUrl } from "@avokjs/helpers";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { txReduce, type TxState } from "@avokjs/helpers";
import { config, hasEnsSubname, hasSnsSubname } from "../config.js";
import { Screen, Card, Field, Button, AddressText, ErrorNote, TxStatus } from "../ui/index.js";

type Err = { kind: SendErrorKind; message: string } | null;
type Fee = { token: Address; price: bigint; treasury: Address } | null | undefined;

// ENS subnames always mint on Ethereum mainnet (chainId 1).
const SUBNAME_CHAIN_ID = ENS_SUBNAME_CHAIN_ID;
const secLabel = { fontSize: "11px", textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text3)", marginBottom: "10px" };

export function Subname(ctx: Ctx): HTMLElement {
  const account = ctx.client.account();

  const root = el("div");
  let s = {
    kind: (hasEnsSubname ? "ens" : "sns") as "ens" | "sns",
    label: "",
    available: null as boolean | null,
    fee: undefined as Fee,
    minted: null as string | null,
    txState: "idle" as TxState,
    explorerUrl: undefined as string | undefined,
    err: null as Err,
    checking: false,
    minting: false,
    lookup: "",
    resolved: undefined as { evm?: string; solana?: string } | null | undefined,
    resolving: false,
    resolveErr: null as Err,
  };
  const set = (p: Partial<typeof s>) => {
    s = { ...s, ...p };
    root.replaceChildren(view());
  };

  function activeParent(): string | undefined {
    return s.kind === "ens" ? config.subname.parent : config.sns.parent;
  }
  function activeConfigured(): boolean {
    return s.kind === "ens" ? hasEnsSubname : hasSnsSubname;
  }

  function switchKind(next: "ens" | "sns"): void {
    set({ kind: next, available: null, fee: undefined, minted: null, err: null, explorerUrl: undefined, txState: txReduce(s.txState, "reset") });
  }

  async function handleCheck(): Promise<void> {
    set({ available: null, err: null, checking: true });
    try {
      if (s.kind === "ens") {
        const parent = ctx.config.subname.parent!;
        // Availability is a registration-support read, so it comes from the add-on's registrar —
        // no registrar address needed for the read itself.
        const ens = createEnsRegistrar({ chainId: SUBNAME_CHAIN_ID, parent, client: ensPublicClient as never });
        const ok = await ens.isAvailable(fullName(s.label.trim(), parent));
        const fee = ok && ctx.config.subname.registrar
          ? await readMintFee({ client: ensPublicClient as never, registrar: ctx.config.subname.registrar })
          : undefined;
        set({ available: ok, fee, checking: false });
      } else {
        // SNS: a name is available when nothing forward-resolves for it (helpers' resolver).
        const taken = await resolver.resolveForward(`${s.label.trim()}.${ctx.config.sns.parent}`);
        set({ available: taken === null, fee: undefined, checking: false });
      }
    } catch (e) {
      set({ err: classifySendError(e), checking: false });
    }
  }

  async function handleMint(): Promise<void> {
    if (!s.label.trim()) return;
    set({ err: null, minting: true, txState: txReduce(s.txState, "submit") });
    try {
      const account = ctx.client.account()!;
      if (s.kind === "ens") {
        // BUILD (add-on) -> SEND (wallet). The add-on returns [approve?, mint, setPrimary] and
        // never broadcasts; `voucher` is omitted here, so the registrar must be open-claim.
        // A vouchered operator would fetch one from its own service (subnames/server) first.
        const { name, calls } = await buildSubnameMintCalls({
          label: s.label.trim(),
          owner: account.evm.address,
          parent: ctx.config.subname.parent!,
          registrar: ctx.config.subname.registrar!,
          client: ensPublicClient as never,
          solanaAddress: account.solana.address,
        });
        const opts = { chainId: SUBNAME_CHAIN_ID, feeToken: null };
        const sim = await ctx.client.evm.simulate(calls, opts);
        const receipt = await ctx.client.evm.send(sim, opts);
        const signed = txReduce(s.txState, "signed");
        set({ minted: name, explorerUrl: getChain(SUBNAME_CHAIN_ID)?.explorerTxUrl(receipt.id), txState: txReduce(signed, "mined"), minting: false });
      } else {
        // SNS (.sol): mint on submit — a "taken" name surfaces as a transaction error.
        const rpcUrl = solanaRpcUrl(SNS_CLUSTER, ctx.config.rpcUrls);
        const { name, instructions } = await buildSnsMintIx({
          label: s.label.trim(),
          owner: account.solana.address,
          parent: ctx.config.sns.parent!,
          registrar: ctx.config.sns.registrar!,
          rpc: createSolanaRpc(rpcUrl),
          buildRegister: createSubRegistrarRegister({ rpcUrl }),
        });
        const opts = { cluster: SNS_CLUSTER, feeToken: null };
        const sim = await ctx.client.solana.simulate(instructions, opts);
        const receipt = await ctx.client.solana.send(sim, opts);
        const signed = txReduce(s.txState, "signed");
        set({ minted: name, explorerUrl: solanaExplorerTxUrl(SNS_CLUSTER, receipt.id), txState: txReduce(signed, "mined"), minting: false });
      }
    } catch (e) {
      set({ err: classifySendError(e), txState: txReduce(s.txState, "reject"), minting: false });
    }
  }

  async function handleResolve(): Promise<void> {
    set({ resolveErr: null, resolved: undefined, resolving: true });
    try {
      // Any ENS/SNS name → address(es) via helpers' resolver (.sol→SNS, else→ENS). This needs
      // NO subname config and NO add-on — resolution is core-safe (#6).
      set({ resolved: await resolver.resolveForward(s.lookup.trim()), resolving: false });
    } catch (e) {
      set({ resolveErr: classifySendError(e), resolving: false });
    }
  }

  function previewText(label: string): string {
    const p = activeParent();
    return label.trim() && p ? fullName(label.trim(), p) : `your-name.${p ?? "…"}`;
  }

  function view(): Node {
    if (!account) return el("div");

    if (!hasEnsSubname && !hasSnsSubname) {
      return Screen(
        { title: "Subname", onBack: () => ctx.go("account") },
        el(
          "p",
          { style: { fontSize: "13px", lineHeight: "1.55", color: "var(--text2)" } },
          "Subnames aren't currently configured for this app.",
        ),
      );
    }

    const done = s.txState === "confirmed" || s.txState === "failed";
    // Live preview node updated imperatively on name input (keeps input focus).
    const preview = el("b", null, previewText(s.label));

    const claimBody = !activeConfigured()
      ? el(
          "p",
          { style: { fontSize: "12px", margin: "0", color: "var(--text2)" } },
          s.kind === "ens"
            ? "ENS subnames aren't currently configured for this app."
            : "SNS subnames aren't currently configured for this app.",
        )
      : el(
          "div",
          null,
          Field({
            label: "Name",
            value: s.label,
            placeholder: "e.g. ada",
            below: el("div", { style: { fontSize: "12px", marginTop: "6px", color: "var(--text2)" } }, "You'll get ", preview),
            onChange: (v) => {
              s.label = v;
              preview.textContent = previewText(v);
            },
          }),

          el(
            "div",
            { style: { display: "flex", gap: "9px", marginBottom: "10px" } },
            Button({ variant: "ghost", label: s.kind === "ens" && s.checking ? "Checking…" : "Check availability", disabled: (s.kind === "ens" && s.checking) || !s.label.trim(), onClick: () => void handleCheck() }),
            Button({ variant: "primary", label: s.minting || s.txState === "signing" ? "Minting…" : "Mint", disabled: s.minting || s.available === false, onClick: () => void handleMint() }),
          ),

          s.available === true && el("p", { style: { fontSize: "12px", margin: "0 0 8px", color: "var(--text2)" } }, `${previewText(s.label)} is available.`),
          s.available === false && el("p", { style: { fontSize: "12px", margin: "0 0 8px", color: "var(--text2)" } }, `${previewText(s.label)} is taken.`),
          s.kind === "ens" && s.fee && el("p", { style: { fontSize: "12px", margin: "0 0 8px", color: "var(--text2)" } }, `Mint fee: ${s.fee.price === 0n ? "free" : `${s.fee.price} (token ${s.fee.token})`}`),
          s.kind === "sns" && el("p", { style: { fontSize: "12px", margin: "0 0 8px", color: "var(--text2)" } }, "SNS registration is paid by your wallet on submit."),

          s.txState !== "idle" && el("div", { style: { marginBottom: "8px" } }, TxStatus({ state: s.txState, explorerUrl: s.explorerUrl })),
          s.minted && el("p", { style: { fontSize: "13px", margin: "0 0 8px", color: "var(--text2)" } }, "Minted ", el("b", null, s.minted), " — it's yours."),
          s.err && ErrorNote(s.err),
          done && Button({ variant: "ghost", label: "Dismiss", onClick: () => set({ txState: txReduce(s.txState, "reset"), err: null }) }),
        );

    return Screen(
      { title: "Subname", onBack: () => ctx.go("account") },

      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Your name"),
        account.evm.subname
          ? el("div", { style: { fontSize: "14px", fontWeight: "600" } }, account.evm.subname)
          : el("p", { style: { fontSize: "12px", margin: "0", color: "var(--text2)" } }, "You haven't claimed an subname yet."),
      ),

      Card(
        { style: { marginBottom: "16px" } },
        el("div", { style: secLabel }, "Claim a name"),
        el(
          "div",
          { style: { display: "flex", gap: "8px", marginBottom: "12px" } },
          Button({ variant: s.kind === "ens" ? "primary" : "ghost", label: "ENS (.eth)", onClick: () => switchKind("ens") }),
          Button({ variant: s.kind === "sns" ? "primary" : "ghost", label: "SNS (.sol)", onClick: () => switchKind("sns") }),
        ),
        claimBody,
      ),

      Card(
        null,
        el("div", { style: secLabel }, "Look up a name"),
        Field({
          label: "Name",
          value: s.lookup,
          placeholder: `e.g. ada.${config.subname.parent ?? "avok.eth"} or alice.sol`,
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
    );
  }

  root.replaceChildren(view());
  return root;
}
