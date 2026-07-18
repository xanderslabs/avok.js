import { useEffect, useState } from "react";
import { useAccount, useAvok } from "@avokjs/react";
import { encodeFunctionData, erc20Abi, numberToHex, parseUnits, type Address, type Hex } from "viem";
import { getTransferSolInstruction } from "@solana-program/system";
import { getChain, chainName, solanaTokens, selectableChains } from "@avokjs/helpers";
import { solanaExplorerTxUrl } from "@avokjs/helpers";
import { formatAmount } from "@avokjs/helpers";
import { txReduce, type TxState } from "@avokjs/helpers";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { resolveRecipient } from "@avokjs/helpers";
import { resolver } from "../resolver.js";
import { hasEvmSponsored, hasSolanaSponsored, config, type SolanaCluster } from "../config.js";
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
  Icon,
  Stack,
  Text,
} from "../ui/index.js";

// #3 reshaped the client and removed the per-verb React hooks; the shared-origin client still exposes
// the `evm`/`solana` namespaces directly (same as the vanilla demo), so we reach them off `useAvok()`.
// `UseOnlyAvokClient` doesn't surface them at the type level, hence this structural view.
type SolanaSim = { success: boolean; error?: string; fee?: { feeToken: string; amount: bigint }; nativeFee?: { baseFee: bigint; priorityFee: bigint; rent: bigint }; [k: string]: unknown };
interface ClientNamespaces {
  evm: { feeTokens(chainId: number): { address: string; symbol: string; decimals: number }[] };
  solana: {
    feeTokens(cluster: string): { mint: string; symbol: string; decimals: number }[];
    supportedFeeTokens(cluster: string): Promise<{ mint: string; symbol: string; decimals: number }[]>;
    simulate(ix: unknown[], opts: { cluster: string; feeToken: string | null }): Promise<SolanaSim>;
    send(sim: SolanaSim, opts: { cluster: string; feeToken: string | null }): Promise<{ signature?: string; id: string }>;
    wait(receipt: { signature?: string; id: string }): Promise<{ status: string; signature?: string; error?: string }>;
    buildSplTransfer(args: { mint: string; to: string; amount: bigint; cluster: string; feeToken: string | null }): Promise<unknown[]>;
  };
}

/**
 * SHARED-ORIGIN IS A DAPP. The EVM rail drives the standard EIP-1193/5792 provider — the wallet's sign
 * popup owns the fee + consent (sign-what-you-saw), so the dapp builds the calls, submits via
 * `wallet_sendCalls`, and tracks with `wallet_getCallsStatus`.
 *
 * The Solana SEND rail stays on the SDK: the Wallet Standard has no EIP-5792 `paymasterService`
 * equivalent, so there is no slot through which a dapp could ask for a sponsored send or name a fee
 * token. Sponsoring is therefore driven here, through `client.solana` + Kora. (Message-signing DOES go
 * through the Wallet Standard — see Account.tsx.) The wired client always announces this provider; it
 * is narrowly typed on `useAvok()`, hence the cast.
 */
type Eip1193Like = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type Eip5792CallsStatus = { status: number; receipts?: { status: Hex; transactionHash: Hex }[] };

type Rail = "evm" | "solana";
type FeeMode = "self" | "sponsored";

// Shared-origin apps don't manage custody (no anchor) — display-default is the first selectable chain.
const DEFAULT_EVM_CHAIN = selectableChains[0]?.id ?? 8453;
const CLUSTERS: SolanaCluster[] = ["devnet", "mainnet"];
/** SOL is 9-dec (lamports). The native asset's decimals are never the fee TOKEN's — see the EVM note. */
const SOL_DECIMALS = 9;

export function Send() {
  const { account } = useAccount();
  const client = useAvok();
  const [rail, setRail] = useState<Rail>("evm");
  const [chainId, setChainId] = useState(DEFAULT_EVM_CHAIN);
  const [cluster, setCluster] = useState<SolanaCluster>("devnet");
  const [tokenIdx, setTokenIdx] = useState(0);
  const [feeMode, setFeeMode] = useState<FeeMode>("self");
  const [feeTokenIdx, setFeeTokenIdx] = useState(0);
  const [to, setTo] = useState("");
  const [resolvedTo, setResolvedTo] = useState<string | null>(null);
  const [resolvedFrom, setResolvedFrom] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"form" | "review">("form");
  // EVM goes through the provider (wallet_sendCalls); hold the built calls, not a simulation — the
  // wallet popup owns the fee + consent. Solana keeps its app-side simulation.
  const [evmSendCalls, setEvmSendCalls] = useState<{ to: Address; value: bigint; data: Hex }[] | null>(null);
  const [solSim, setSolSim] = useState<SolanaSim | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [err, setErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | undefined>(undefined);

  const c = client as unknown as ClientNamespaces;
  const evmFeeTokens = (id: number) => c.evm.feeTokens(id);
  const solanaFeeTokens = (cl: string) => c.solana.feeTokens(cl);

  // What KORA accepts on this cluster (registry ∩ Kora), loaded per cluster. Unreachable Kora ⇒ no
  // sponsored options, which is the truth: nothing will front this send.
  const [solSupportedFeeTokens, setSolSupportedFeeTokens] = useState<{ mint: string; symbol: string; decimals: number }[]>([]);
  useEffect(() => {
    let live = true;
    if (!hasSolanaSponsored) {
      setSolSupportedFeeTokens([]);
      return;
    }
    c.solana
      .supportedFeeTokens(cluster)
      .then((t) => { if (live) setSolSupportedFeeTokens(t); })
      .catch(() => { if (live) setSolSupportedFeeTokens([]); });
    return () => { live = false; };
  }, [cluster]);
  // Local pending flags replace the removed hooks' `pending` — keeps the button-disable UX.
  const [solSimulating, setSolSimulating] = useState(false);
  const [solSending, setSolSending] = useState(false);
  const solSimulate = async (ix: unknown[], opts: { cluster: string; feeToken: string | null }) => {
    setSolSimulating(true);
    try { return await c.solana.simulate(ix, opts); } finally { setSolSimulating(false); }
  };
  const solSend = async (sim: SolanaSim, opts: { cluster: string; feeToken: string | null }) => {
    setSolSending(true);
    try { return await c.solana.send(sim, opts); } finally { setSolSending(false); }
  };

  if (!account) return null;

  // Fee tokens are chain-specific ERC-20/SPL addresses — read them for the chain THIS transaction
  // executes on, never from a global env var. Sponsored needs the paymaster/bundler (EVM) or Kora
  // (Solana) URL AND at least one supported fee token on that chain.
  const evmFeeList = rail === "evm" ? evmFeeTokens(chainId) : [];
  // Solana asks KORA what it accepts, rather than offering the whole registry catalogue: a token the
  // configured fee payer refuses would fail at signing time for no reason the user could see.
  const solFeeList = solSupportedFeeTokens;
  const sponsoredFeeTokens =
    rail === "evm"
      ? evmFeeList.map((t) => ({ key: t.address as string, symbol: t.symbol }))
      : solFeeList.map((t) => ({ key: t.mint, symbol: t.symbol }));
  const canSponsored = (rail === "evm" ? hasEvmSponsored : hasSolanaSponsored) && sponsoredFeeTokens.length > 0;
  const effectiveFeeMode: FeeMode = canSponsored ? feeMode : "self";
  const selectedFeeToken =
    effectiveFeeMode === "sponsored" ? (sponsoredFeeTokens[feeTokenIdx]?.key ?? null) : null;

  const chain = rail === "evm" ? getChain(chainId) : undefined;
  const evmToken = chain?.tokens[tokenIdx];
  // Solana rail token list: native SOL first, then the cluster's registry SPL tokens. Reuses tokenIdx.
  const solTokens = solanaTokens(cluster);
  const solToken = solTokens[tokenIdx] ?? solTokens[0];
  const decimals = rail === "evm" ? (evmToken?.decimals ?? 18) : solToken.decimals;
  const symbol = rail === "evm" ? (evmToken?.symbol ?? "") : solToken.symbol;

  let amountBase: bigint | null = null;
  try {
    amountBase = amount.trim() ? parseUnits(amount.replace(/,/g, ""), decimals) : null;
  } catch {
    amountBase = null;
  }
  // The recipient may be a raw address or any ENS/SNS name — resolution (in handleReview)
  // validates it, so the form gate only needs a non-empty recipient + a positive amount.
  const canReview = to.trim() !== "" && amountBase !== null && amountBase > 0n && (rail === "evm" ? !!evmToken : true);
  // EVM has no app-side simulate (the wallet simulates in its popup); its "busy" is the tx FSM.
  const simulating = rail === "evm" ? false : solSimulating;
  const sending = rail === "evm" ? txState === "signing" || txState === "pending" : solSending;

  function switchRail(next: Rail) {
    setRail(next);
    setStep("form");
    setTokenIdx(0);
    setFeeTokenIdx(0);
    setEvmSendCalls(null);
    setSolSim(null);
    setSimError(null);
    setErr(null);
    setResolvedTo(null);
    setResolvedFrom(null);
    setExplorerUrl(undefined);
    setTxState((s) => txReduce(s, "reset"));
  }

  /** The token's SYMBOL, never its address. An address on a consent screen is unreadable, and a user
   *  cannot verify what they cannot read. */
  function feeTokenSymbol(addr: string | null): string {
    if (!addr) return rail === "evm" ? (chain?.nativeSymbol ?? "native") : "SOL";
    // Look the symbol up on the rail the transaction actually runs on. This only ever searched the
    // EVM chain's tokens, so a Solana fee token found nothing and fell through to its raw mint —
    // putting "you repay it in CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM" on a consent screen. A
    // user cannot verify what they cannot read.
    if (rail === "solana") {
      return solanaFeeTokens(cluster).find((t) => t.mint === addr)?.symbol ?? addr;
    }
    return chain?.tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase())?.symbol ?? addr;
  }

  function feeLabelSolana(s: SolanaSim): string {
    // SPONSORED: exact, signed, paid in an SPL token.
    if (s.fee) {
      const profile = solanaFeeTokens(cluster).find((t) => t.mint === s.fee!.feeToken);
      const dec = profile?.decimals ?? 6;
      const sym = profile?.symbol ?? "token";
      return `${formatAmount(s.fee.amount, dec)} ${sym}`;
    }
    // SELF-PAY: paid in SOL, so it is an estimate. It used to read "~15000 compute units (paid in
    // SOL)" — a raw machine number is not something a person can consent to.
    if (s.nativeFee) {
      const fee = `≈ ${formatAmount(s.nativeFee.baseFee + s.nativeFee.priorityFee, SOL_DECIMALS)} SOL (estimated)`;
      // Rent is NOT a fee and is never folded into one: it funds the RECIPIENT's new token account,
      // it is theirs to reclaim, and at ~0.00204 SOL it is several hundred times the fee itself. The
      // one-line surprise it would otherwise be is exactly what a consent screen exists to prevent.
      if (s.nativeFee.rent > 0n) {
        return `${fee} + ${formatAmount(s.nativeFee.rent, SOL_DECIMALS)} SOL deposit to open the recipient's ${symbol} account (refundable to them)`;
      }
      return fee;
    }
    return "unavailable";
  }

  async function handleReview() {
    if (!canReview || amountBase === null) return;
    setSimError(null);
    // Resolve the recipient first — accepts a raw address or any ENS/SNS name, and
    // hands back the address we pass into the tx args (the app-wide resolve pattern).
    const rr = await resolveRecipient(resolver, to, rail);
    if ("error" in rr) {
      setSimError(rr.error);
      return;
    }
    const toAddr = rr.address;
    setResolvedTo(toAddr);
    setResolvedFrom(rr.resolvedFrom ?? null);
    try {
      if (rail === "evm") {
        if (!evmToken || !chain) return;
        // Dapp path: build the calls and let the wallet own the fee + consent at Confirm time. No
        // app-side simulate — the wallet's sign popup simulates and enforces sign-what-you-saw.
        setEvmSendCalls([
          {
            to: evmToken.address,
            value: 0n,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [toAddr as Address, amountBase] }),
          },
        ]);
      } else {
        if (!account) return;
        // Native SOL: a plain system transfer. SPL token: the SDK owns the ATA + per-rail rent-payer
        // logic (self-pay → the user pays gas; sponsored → the paymaster SPONSORS gas and the user repays it in the fee token), so the demo just calls it. The `as never`
        // casts on the native path match the vanilla demo — kit's address-branded types reject bare strings.
        const ix = solToken.mint === null
          ? [
              getTransferSolInstruction({
                source: { address: account.solana.address } as never,
                destination: toAddr as never,
                amount: amountBase,
              }),
            ]
          : await c.solana.buildSplTransfer({
              mint: solToken.mint,
              to: toAddr,
              amount: amountBase,
              cluster,
              feeToken: selectedFeeToken,
            });
        const result = await solSimulate(ix, {
          cluster: cluster,
          feeToken: selectedFeeToken,
        });
        if (!result.success) {
          setSimError(result.error ?? "Transaction would revert");
          return;
        }
        setSolSim(result);
      }
      setStep("review");
    } catch (e) {
      setSimError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleConfirm() {
    setErr(null);
    setTxState((s) => txReduce(s, "submit"));
    try {
      if (rail === "evm") {
        if (!evmSendCalls || !chain) return;
        // THE DAPP PATH. Submit through the standard EIP-5792 provider; the wallet's sign popup shows the
        // fee + calls, enforces "sign what you saw", and signs. A `paymasterService` capability routes it
        // sponsored (the wallet sponsors gas, the user repays in the chosen fee token).
        const provider = (client as unknown as { getEip1193Provider(): Eip1193Like }).getEip1193Provider();
        const capabilities = selectedFeeToken
          ? { paymasterService: { url: config.paymasterUrl!, context: { token: selectedFeeToken } } }
          : undefined;
        const { id } = (await provider.request({
          method: "wallet_sendCalls",
          params: [{
            version: "2.0.0",
            from: account!.evm.address, // guarded by the component-level `if (!account) return null`
            chainId: numberToHex(chain.id),
            atomicRequired: false,
            calls: evmSendCalls.map((c) => ({ to: c.to, value: numberToHex(c.value), data: c.data })),
            ...(capabilities ? { capabilities } : {}),
          }],
        })) as { id: string };
        setTxState((s) => txReduce(s, "signed"));
        // Track via wallet_getCallsStatus until included (5792 status 200) — NEVER round a still-pending
        // send up to success; the id is not a tx hash until a receipt carries one.
        const deadline = Date.now() + 90_000;
        let done: Eip5792CallsStatus | null = null;
        for (;;) {
          const st = (await provider.request({ method: "wallet_getCallsStatus", params: [id] })) as Eip5792CallsStatus;
          if (st.status === 200) { done = st; break; }
          if (Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        const receipt0 = done?.receipts?.[0];
        if (receipt0?.transactionHash) setExplorerUrl(chain.explorerTxUrl(receipt0.transactionHash));
        setTxState((s) => txReduce(s, done && receipt0?.status === "0x1" ? "mined" : "revert"));
        if (done && receipt0?.status === "0x0") {
          setErr({ kind: "sponsored-unavailable", message: "The transaction was included but reverted on-chain." });
        } else if (!done) {
          setErr({ kind: "unknown", message: "The transaction was accepted but has not confirmed yet. Check the explorer before retrying — it may still land." });
        }
      } else {
        if (!solSim) return;
        const receipt = await solSend(solSim, {
          cluster: cluster,
          feeToken: selectedFeeToken,
        });
        setTxState((s) => txReduce(s, "signed"));
        // Same rule as the EVM branch above, and it was NOT being followed here. A self-pay receipt is
        // SUBMITTED (broadcast, not mined). A sponsored receipt is PENDING, carries no signature at all,
        // and its `id` is the relayer's INTENT ID — so `receipt.signature ?? receipt.id` linked the
        // intent id to an explorer, which answered "Signature ... is not valid", while the screen said
        // Confirmed. Never link an id, and never call anything confirmed that the chain has not.
        if (receipt.signature) setExplorerUrl(solanaExplorerTxUrl(cluster, receipt.signature));
        const final = await c.solana.wait(receipt);
        if (final.signature) setExplorerUrl(solanaExplorerTxUrl(cluster, final.signature));
        setTxState((s) => txReduce(s, final.status === "confirmed" ? "mined" : "revert"));
        // A bare "Failed" is undiagnosable. The relayer tells us why it could not submit; show it.
        if (final.status === "failed" && final.error) {
          setErr({ kind: "sponsored-unavailable", message: `The relayer could not submit this transaction: ${final.error}` });
        } else if (final.status !== "confirmed" && final.status !== "failed") {
          setErr({
            kind: "unknown",
            message:
              final.status === "expired"
                ? "The transaction's blockhash expired before it landed, so it can never confirm. It is safe to try again."
                : "The transaction was accepted but has not confirmed yet. Check the explorer before retrying — it may still land.",
          });
        }
      }
    } catch (e) {
      setErr(classifySendError(e));
      setTxState((s) => txReduce(s, "reject"));
    }
  }

  function startOver() {
    setStep("form");
    setEvmSendCalls(null);
    setSolSim(null);
    setSimError(null);
    setErr(null);
    setExplorerUrl(undefined);
    setTxState((s) => txReduce(s, "reset"));
  }

  if (step === "review" && (evmSendCalls || solSim)) {
    // EVM (dapp) rail: the WALLET shows the authoritative fee in its popup, so the dapp doesn't invent
    // one. Solana still renders its own fee (the SDK path).
    const fee = rail === "evm" ? "shown in your wallet when you confirm" : solSim ? feeLabelSolana(solSim) : "";
    // A consent screen is READ, not skimmed. Every line is a plain fact in the user's own units: no
    // chain ids, no token addresses, no gas units. It must be checkable at a glance by someone who
    // does not know what a base unit is.
    const lines = [
      rail === "evm" ? `Chain: ${chainName(chainId)}` : `Chain: Solana ${cluster}`,
      resolvedFrom
        ? `Send: ${amount} ${symbol} to ${resolvedFrom} (${resolvedTo})`
        : `Send: ${amount} ${symbol} to ${resolvedTo ?? to}`,
      effectiveFeeMode === "sponsored"
        ? `Fee mode: sponsored — the paymaster pays the network fee and you repay it in ${feeTokenSymbol(selectedFeeToken)}`
        : `Fee mode: self-pay — you pay the network fee yourself, in ${rail === "evm" ? (chain?.nativeSymbol ?? "native") : "SOL"} (this chain's native gas asset)`,
      `Transaction fee: ${fee}`,
    ];
    const done = txState === "confirmed" || txState === "failed";
    return (
      <Screen title="Confirm transfer">
        <ConsentLines lines={lines} />
        <div style={{ marginTop: 14 }}>
          <TxStatus state={txState} explorerUrl={explorerUrl} />
        </div>
        {err && (
          <div style={{ marginTop: 10 }}>
            <ErrorNote kind={err.kind} message={err.message} />
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <Stack direction="row" gap="sm">
          {done ? (
            <Button variant="primary" onClick={startOver}>
              Send another
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep("form")} disabled={sending}>
                Reject
              </Button>
              <Button
                variant="primary"
                icon={<Icon name="passkey" size={15} />}
                onClick={handleConfirm}
                disabled={sending || txState === "signing" || txState === "pending"}
              >
                {sending || txState === "signing" ? "Signing…" : "Confirm"}
              </Button>
            </>
          )}
          </Stack>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Send">
      <div style={{ marginBottom: 14 }}>
        <ChainSwitcher
          chains={[...selectableChains.map((c) => ({ id: c.id, name: c.name })), { id: -1, name: "Solana" }]}
          selected={rail === "evm" ? chainId : -1}
          onSelect={(id) => {
            if (id === -1) switchRail("solana");
            else {
              switchRail("evm");
              setChainId(id);
            }
          }}
        />
      </div>

      {rail === "solana" && (
        <Card>
          <div className="section-label">Cluster</div>
          <div className="segmented">
            {CLUSTERS.map((c) => (
              <button
                key={c}
                className={cluster === c ? "segmented-btn segmented-active" : "segmented-btn"}
                onClick={() => { setCluster(c); setTokenIdx(0); }}
              >
                {c === "mainnet" ? "Mainnet" : "Devnet"}
              </button>
            ))}
          </div>
        </Card>
      )}

      {rail === "solana" && solTokens.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <button className="chain" onClick={() => setTokenIdx((i) => (i + 1) % solTokens.length)}>
            ◎ Solana {cluster} · {symbol}
          </button>
        </div>
      )}

      <Field
        label="To"
        value={to}
        onChange={(v) => {
          setTo(v);
          setResolvedTo(null);
          setResolvedFrom(null);
        }}
        placeholder={rail === "evm" ? "0x… address or name (e.g. alice.eth)" : "Solana address or name (e.g. alice.sol)"}
      />
      {resolvedFrom && resolvedTo && (
        <Text variant="label" tone="subtle" as="div" style={{ marginTop: -8, marginBottom: 12 }}>
          {resolvedFrom} → {resolvedTo}
        </Text>
      )}

      <AmountField
        value={amount}
        token={rail === "evm" && chain && chain.tokens.length > 1 ? `${symbol} ▾` : symbol}
        onChange={setAmount}
      />
      {rail === "evm" && chain && chain.tokens.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <button className="chain" onClick={() => setTokenIdx((i) => (i + 1) % chain.tokens.length)}>
            ◆ {chainName(chainId)} · {symbol}
          </button>
        </div>
      )}

      <Card>
        <div className="section-label">Fee mode</div>
        <div className="segmented">
          <button
            className={effectiveFeeMode === "self" ? "segmented-btn segmented-active" : "segmented-btn"}
            onClick={() => setFeeMode("self")}
          >
            Self-pay
          </button>
          <button
            className={effectiveFeeMode === "sponsored" ? "segmented-btn segmented-active" : "segmented-btn"}
            onClick={() => setFeeMode("sponsored")}
            disabled={!canSponsored}
          >
            Sponsored
          </button>
        </div>
        {effectiveFeeMode === "sponsored" && sponsoredFeeTokens.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="section-label">Fee token</div>
            <div className="segmented">
              {sponsoredFeeTokens.map((t, i) => (
                <button
                  key={t.key}
                  className={feeTokenIdx === i ? "segmented-btn segmented-active" : "segmented-btn"}
                  onClick={() => setFeeTokenIdx(i)}
                >
                  {t.symbol}
                </button>
              ))}
            </div>
          </div>
        )}
        {!canSponsored && (
          <Text variant="micro" tone="subtle" as="div" style={{ marginTop: 8 }}>
            {rail === "evm"
              ? hasEvmSponsored
                ? "Sponsored unavailable — no supported fee token on this chain."
                : "Sponsored (sponsored) sends aren't available for this app."
              : hasSolanaSponsored
                ? "Sponsored unavailable — no supported fee token on this cluster."
                : "Sponsored (sponsored) sends aren't available for this app."}
          </Text>
        )}
      </Card>

      {simError && (
        <div style={{ marginBottom: 10 }}>
          <ErrorNote kind={classifySendError(new Error(simError)).kind} message={simError} />
        </div>
      )}

      <Button variant="primary" onClick={handleReview} disabled={!canReview || simulating}>
        {simulating ? "Simulating…" : "Review transfer"}
      </Button>
    </Screen>
  );
}
