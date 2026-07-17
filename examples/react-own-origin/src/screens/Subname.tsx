import { useState } from "react";
import { useAccount, useAvok } from "@avokjs/react";
import { type Address } from "viem";
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
import { config, hasEnsSubname, hasSnsSubname } from "../config.js";
import { getChain } from "@avokjs/helpers";
import { solanaExplorerTxUrl } from "@avokjs/helpers";
import { classifySendError, type SendErrorKind } from "@avokjs/helpers";
import { txReduce, type TxState } from "@avokjs/helpers";
import { resolver, ensPublicClient } from "../resolver.js";
import { Screen, Card, Field, Button, AddressText, ErrorNote, TxStatus, Stack, Text } from "../ui/index.js";

// #6 — SUBNAMES ARE AN OPTIONAL ADD-ON. The core client has no subname verbs at all: this screen
// BUILDS the mint with @avokjs/subnames and sends the calls itself. Uninstall the add-on and
// only this screen breaks; the wallet keeps working, and name RESOLUTION (../resolver.ts, from
// @avokjs/helpers) keeps working too.
//
// Own-origin sends via the SDK, not the provider (#4's two-product split): this app IS the wallet
// and renders its own fee-bearing consent. A dapp would send the very same calls through the
// provider's wallet_sendCalls instead — the add-on neither knows nor cares. It only builds.
const SUBNAME_CHAIN_ID = ENS_SUBNAME_CHAIN_ID;

/** ENS subnames always mint on Ethereum mainnet; SNS subnames always on Solana mainnet. */
const SNS_CLUSTER = "mainnet" as const;

/** The own-origin send seam — the same structural view Send.tsx uses (see its note). */
type MintCall = { to: `0x${string}`; value: bigint; data: `0x${string}` };
interface OwnClientNS {
  evm: {
    simulate(calls: unknown[], opts: { chainId: number; feeToken: string | null }): Promise<{ success: boolean; [k: string]: unknown }>;
    send(sim: unknown, opts: { chainId: number; feeToken: string | null }): Promise<{ id: string }>;
  };
  solana: {
    simulate(ix: unknown[], opts: { cluster: string; feeToken: string | null }): Promise<{ success: boolean; [k: string]: unknown }>;
    send(sim: unknown, opts: { cluster: string; feeToken: string | null }): Promise<{ id: string }>;
  };
}

export function Subname({ onBack }: { onBack: () => void }) {
  const { account } = useAccount();
  const client = useAvok();
  const c = client as unknown as OwnClientNS;
  const [checking, setChecking] = useState(false);
  const [minting, setMinting] = useState(false);

  const [kind, setKind] = useState<"ens" | "sns">(hasEnsSubname ? "ens" : "sns");
  const [label, setLabel] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [fee, setFee] = useState<{ token: Address; price: bigint; treasury: Address } | null | undefined>(undefined);
  const [minted, setMinted] = useState<string | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [explorerUrl, setExplorerUrl] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);

  const [lookup, setLookup] = useState("");
  const [resolved, setResolved] = useState<{ evm?: string; solana?: string } | null | undefined>(undefined);
  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState<{ kind: SendErrorKind; message: string } | null>(null);

  const activeConfigured = kind === "ens" ? hasEnsSubname : hasSnsSubname;
  const activeParent = kind === "ens" ? config.subname.parent : config.sns.parent;

  if (!account) return null;

  function switchKind(next: "ens" | "sns") {
    setKind(next);
    setAvailable(null);
    setFee(undefined);
    setMinted(null);
    setErr(null);
    setExplorerUrl(undefined);
    setTxState((s) => txReduce(s, "reset"));
  }

  async function handleCheck() {
    setAvailable(null);
    setErr(null);
    try {
      setChecking(true);
      if (kind === "ens") {
        const parent = config.subname.parent!;
        // Availability is a registration-support read, so it comes from the add-on's registrar —
        // no registrar address needed for the read itself.
        const ens = createEnsRegistrar({ chainId: SUBNAME_CHAIN_ID, parent, client: ensPublicClient as never });
        const ok = await ens.isAvailable(fullName(label.trim(), parent));
        setAvailable(ok);
        setFee(ok && config.subname.registrar
          ? await readMintFee({ client: ensPublicClient as never, registrar: config.subname.registrar })
          : undefined);
      } else {
        // SNS: a name is available when nothing forward-resolves for it (helpers' resolver).
        setAvailable((await resolver.resolveForward(`${label.trim()}.${config.sns.parent}`)) === null);
        setFee(undefined);
      }
    } catch (e) {
      setErr(classifySendError(e));
    } finally {
      setChecking(false);
    }
  }

  async function handleMint() {
    if (!label.trim()) return;
    setErr(null);
    setTxState((s) => txReduce(s, "submit"));
    try {
      setMinting(true);
      if (kind === "ens") {
        // BUILD (add-on) → SEND (wallet). The add-on returns [approve?, mint, setPrimary] and
        // never broadcasts; `voucher` is omitted here, so the registrar must be open-claim.
        // A vouchered operator would fetch one from its own service (subnames/server) first.
        const { name, calls } = await buildSubnameMintCalls({
          label: label.trim(),
          owner: account.evm.address as Address,
          parent: config.subname.parent!,
          registrar: config.subname.registrar!,
          client: ensPublicClient as never,
          solanaAddress: account.solana.address,
        });
        const opts = { chainId: SUBNAME_CHAIN_ID, feeToken: null };
        const sim = await c.evm.simulate(calls as MintCall[], opts);
        const receipt = await c.evm.send(sim, opts);
        setTxState((s) => txReduce(s, "signed"));
        setExplorerUrl(getChain(SUBNAME_CHAIN_ID)?.explorerTxUrl(receipt.id));
        setMinted(name);
      } else {
        // SNS (.sol): mint on submit — a "taken" name surfaces as a transaction error.
        const rpcUrl = solanaRpcUrl(SNS_CLUSTER, config.rpcUrls);
        const { name, instructions } = await buildSnsMintIx({
          label: label.trim(),
          owner: account.solana.address,
          parent: config.sns.parent!,
          registrar: config.sns.registrar!,
          rpc: createSolanaRpc(rpcUrl),
          buildRegister: createSubRegistrarRegister({ rpcUrl }),
        });
        const opts = { cluster: SNS_CLUSTER, feeToken: null };
        const sim = await c.solana.simulate(instructions, opts);
        const receipt = await c.solana.send(sim, opts);
        setTxState((s) => txReduce(s, "signed"));
        setExplorerUrl(solanaExplorerTxUrl(SNS_CLUSTER, receipt.id));
        setMinted(name);
      }
      setTxState((s) => txReduce(s, "mined"));
    } catch (e) {
      setErr(classifySendError(e));
      setTxState((s) => txReduce(s, "reject"));
    } finally {
      setMinting(false);
    }
  }

  async function handleResolve() {
    setResolveErr(null);
    setResolved(undefined);
    setResolving(true);
    try {
      // Any ENS/SNS name → address(es) via helpers' resolver (.sol→SNS, else→ENS). This needs
      // NO subname config and NO add-on — resolution is core-safe (#6).
      setResolved(await resolver.resolveForward(lookup.trim()));
    } catch (e) {
      setResolveErr(classifySendError(e));
    } finally {
      setResolving(false);
    }
  }

  if (!hasEnsSubname && !hasSnsSubname) {
    return (
      <Screen title="Subname" onBack={onBack}>
        <Text variant="body" as="p">Subnames aren't currently configured for this app.</Text>
      </Screen>
    );
  }

  const preview = label.trim() ? fullName(label.trim(), activeParent ?? "") : `your-name.${activeParent ?? "…"}`;
  const done = txState === "confirmed" || txState === "failed";

  return (
    <Screen title="Subname" onBack={onBack}>
      <Card>
        <div className="section-label">Your name</div>
        {account.evm.subname ? (
          <Text variant="body" as="div" style={{ fontWeight: 600 }}>
            {account.evm.subname}
          </Text>
        ) : (
          <Text variant="label" tone="subtle" as="p" style={{ margin: 0 }}>
            You haven't claimed an subname yet.
          </Text>
        )}
      </Card>

      <Card>
        <div className="section-label">Claim a name</div>
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button
            className={kind === "ens" ? "segmented-btn segmented-active" : "segmented-btn"}
            onClick={() => switchKind("ens")}
          >
            ENS (.eth)
          </button>
          <button
            className={kind === "sns" ? "segmented-btn segmented-active" : "segmented-btn"}
            onClick={() => switchKind("sns")}
          >
            SNS (.sol)
          </button>
        </div>

        {!activeConfigured ? (
          <Text variant="label" tone="subtle" as="p" style={{ margin: 0 }}>
            {kind === "ens"
              ? "ENS subnames aren't currently configured for this app."
              : "SNS subnames aren't currently configured for this app."}
          </Text>
        ) : (
          <>
            <Field
              label="Name"
              value={label}
              onChange={(v) => {
                setLabel(v);
                setAvailable(null);
                setFee(undefined);
              }}
              placeholder="e.g. ada"
              below={
                <Text variant="label" tone="subtle" as="div" style={{ marginTop: 6 }}>
                  You'll get <b>{preview}</b>
                </Text>
              }
            />

            <div style={{ marginBottom: 10 }}>
              <Stack direction="row" gap="sm">
                <Button variant="ghost" onClick={handleCheck} disabled={(kind === "ens" ? checking : false) || !label.trim()}>
                  {(kind === "ens" && checking) ? "Checking…" : "Check availability"}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleMint}
                  disabled={minting || !label.trim() || available === false}
                >
                  {minting || txState === "signing" ? "Minting…" : "Mint"}
                </Button>
              </Stack>
            </div>

            {available === true && (
              <Text variant="label" tone="success" as="p" style={{ margin: "0 0 8px" }}>
                {preview} is available.
              </Text>
            )}
            {available === false && (
              <Text variant="label" tone="danger" as="p" style={{ margin: "0 0 8px" }}>
                {preview} is taken.
              </Text>
            )}
            {kind === "ens" && fee && (
              <Text variant="label" tone="subtle" as="p" style={{ margin: "0 0 8px" }}>
                Mint fee: {fee.price === 0n ? "free" : `${fee.price} (token ${fee.token})`}
              </Text>
            )}
            {kind === "sns" && (
              <Text variant="label" tone="subtle" as="p" style={{ margin: "0 0 8px" }}>
                SNS registration is paid by your wallet on submit.
              </Text>
            )}

            {txState !== "idle" && (
              <div style={{ marginBottom: 8 }}>
                <TxStatus state={txState} explorerUrl={explorerUrl} />
              </div>
            )}
            {minted && (
              <Text variant="value" as="p" style={{ margin: "0 0 8px" }}>
                Minted <b>{minted}</b> — it's yours.
              </Text>
            )}
            {err && <ErrorNote kind={err.kind} message={err.message} />}
            {done && (
              <Button
                variant="ghost"
                onClick={() => {
                  setTxState((s) => txReduce(s, "reset"));
                  setErr(null);
                }}
              >
                Dismiss
              </Button>
            )}
          </>
        )}
      </Card>

      <Card>
        <div className="section-label">Look up a name</div>
        <Field label="Name" value={lookup} onChange={setLookup} placeholder={`e.g. ada.${config.subname.parent ?? "avok.eth"} or alice.sol`} />
        <Button variant="ghost" onClick={handleResolve} disabled={resolving || !lookup.trim()}>
          {resolving ? "Resolving…" : "Resolve"}
        </Button>
        {resolved !== undefined && (
          <div style={{ marginTop: 10 }}>
            <Stack gap="xs">
              {resolved?.evm && (
                <div className="addr-row">
                  <span className="addr-rail">EVM</span>
                  <AddressText address={resolved.evm} truncate={false} copy />
                </div>
              )}
              {resolved?.solana && (
                <div className="addr-row">
                  <span className="addr-rail">Solana</span>
                  <AddressText address={resolved.solana} truncate={false} copy />
                </div>
              )}
              {(!resolved || (!resolved.evm && !resolved.solana)) && (
                <Text variant="label" tone="subtle" as="p" style={{ margin: 0 }}>
                  No address found.
                </Text>
              )}
            </Stack>
          </div>
        )}
        {resolveErr && (
          <div style={{ marginTop: 8 }}>
            <ErrorNote kind={resolveErr.kind} message={resolveErr.message} />
          </div>
        )}
      </Card>
    </Screen>
  );
}
