import { getSolanaTokenProfile, listFeeTokens, solanaRpcUrl } from "@avokjs/contracts";
import {
  createSolanaRpcClient,
  buildSolanaMessage,
  simulateSolanaMessage,
  estimateSolanaNativeFee,
  buildSplTransfer,
  toRemoteKitSigner,
  sendSolana,
  createKora,
  buildKoraFeePayment,
  type KoraClient,
  type FetchLike,
  type SolanaRpcClient,
  type SimulationResult,
  type FeeBreakdown as SolanaFeeBreakdown,
  type FeePayer,
  type Receipt,
} from "../solana/index.js";
import { base58 } from "@scure/base";
import { getBase64EncodedWireTransaction, compileTransaction } from "@solana/kit";
import type { Instruction, TransactionPartialSigner } from "@solana/kit";
import { UnsupportedFeeTokenError } from "./fee-token-error.js";
import type { ClientConfig } from "../types.js";

const DEFAULT_CU_LIMIT = 200_000;
const DEFAULT_CU_PRICE = 1_000n; // micro-lamports/CU; overridable via opts

export interface FeeToken {
  symbol: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
}

export interface SolanaTxOpts {
  cluster?: string;
  // A fee-token mint → sponsored (when a Kora is configured); absent or null → self-pay. There is no
  // default to override: the token is chosen per send — mirrors EVM's `feeToken: null`.
  feeToken?: string | null;
  computeUnitPrice?: bigint;
  computeUnitLimit?: number;
}

export interface SolanaResolved {
  message: unknown;
  lastValidBlockHeight: bigint;
  cluster: "mainnet" | "devnet";
  rail: "self-pay" | "sponsored";
  feeToken?: string;
  expectedFee?: bigint;
}

export type SolanaSimulation = SimulationResult & { resolved: SolanaResolved };

export interface SolanaNamespace {
  /** Every fee token the REGISTRY knows for this cluster. Static — what Avok can describe, not what
   *  your fee payer accepts. For the pickable list, use `supportedFeeTokens`. */
  feeTokens(cluster?: string): FeeToken[];
  /**
   * The fee tokens THIS Kora actually accepts, narrowed to mints the registry can describe. This is the
   * list to put in front of a user: `feeTokens` is a catalogue, and offering a token the configured
   * fee payer refuses produces a send that fails at signing time for no reason the user can see.
   *
   * Empty when no Kora is configured — there is no sponsoring on offer, so there is nothing to pick.
   */
  supportedFeeTokens(cluster?: string): Promise<FeeToken[]>;
  // Public boundary stays permissive: callers pass whatever @solana/kit instruction builders emit.
  // The single `as Instruction[]` at the entry points below is the one honest cast where untyped
  // user input crosses into the strictly-typed core (build path), replacing the old deep `as never`s.
  simulate(instructions: unknown[], opts?: SolanaTxOpts): Promise<SolanaSimulation>;
  send(input: SolanaSimulation | unknown[], opts?: SolanaTxOpts): Promise<Receipt>;
  /**
   * Poll until the transaction actually lands. THE ONLY PRODUCER OF `"confirmed"`.
   *
   * `send()` returns as soon as the transaction is handed off — "submitted" on self-pay (broadcast,
   * not mined) and "pending" on sponsored, where the receipt's `id` is the RELAYER'S INTENT ID and
   * there is no signature yet at all. Neither is a confirmation, and neither can be linked to an
   * explorer. Treating them as success is how a transaction that never landed gets reported as done.
   */
  wait(receipt: Receipt, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<Receipt>;
  signMessage(message: string): Promise<{ signature: string }>;
  /** Build the instructions for an SPL token transfer. Derives the recipient ATA and prepends an
   *  idempotent create-ATA when it is missing. The create-ATA rent payer is resolved per rail:
   *  in sponsored (a `feeToken` mint) Kora's fee payer sponsors the rent (Kora prices it into its own
   *  quote); in self-pay the user funds it in SOL. `decimals`
   *  and `tokenProgram` are looked up from the registry — throws when the mint is unknown to the
   *  cluster. Pass the result straight to `simulate`/`send` with the SAME `{ cluster, feeToken }`. */
  buildSplTransfer(args: { mint: string; to: string; amount: bigint; cluster?: string; feeToken?: string | null }): Promise<Instruction[]>;
}

/** Resolves the given cluster (required, per-call) and throws if it is not a valid cluster. */
function resolveCluster(cluster?: string): "mainnet" | "devnet" {
  if (cluster !== "mainnet" && cluster !== "devnet") throw new Error("Solana cluster required (mainnet|devnet)");
  return cluster;
}

function feeTokenProgram(cluster: "mainnet" | "devnet", mint: string): string {
  const p = getSolanaTokenProfile(cluster, mint);
  if (!p) throw new Error(`Unsupported fee token ${mint} on solana:${cluster}`);
  return p.tokenProgram;
}

/** Bytes this fee token's ATA occupies — measured per mint (a Token-2022 account is not 165). */
function feeTokenAtaSize(cluster: "mainnet" | "devnet", mint: string): number {
  const p = getSolanaTokenProfile(cluster, mint);
  if (!p) throw new Error(`Unsupported fee token ${mint} on solana:${cluster}`);
  return p.ataSize;
}

function feeTokenDecimals(cluster: "mainnet" | "devnet", mint: string): number {
  const p = getSolanaTokenProfile(cluster, mint);
  if (!p) throw new Error(`Unsupported fee token ${mint} on solana:${cluster}`);
  return p.decimals;
}

export function createSolanaNamespace(config: ClientConfig): SolanaNamespace {
  const { connection } = config;

  function resolveSolanaFeeToken(cluster: "mainnet" | "devnet", opts?: SolanaTxOpts): string | undefined {
    // Per-send only. There is no `defaultSolanaFeeToken`: a fee token is a payment the user makes, and a
    // wallet must not pick one on their behalf. The options come from Kora's `getSupportedTokens()`.
    const token = opts?.feeToken ?? undefined;
    if (!token) return undefined;
    // A fee token is an SPL mint, and mints are cluster-specific. Validate against the TARGET
    // cluster's registry tokens — never forward a mint that means nothing here to Kora.
    if (!getSolanaTokenProfile(cluster, token)) throw new UnsupportedFeeTokenError(token, `solana:${cluster}`);
    return token;
  }

  function requireSolanaAddress(): string {
    const a = connection.account()?.solana.address;
    if (!a) throw new Error("no active account");
    return a;
  }

  function resolveSolanaRpc(cluster: "mainnet" | "devnet"): SolanaRpcClient {
    if (config.deps?.solanaRpc) return config.deps.solanaRpc;
    // config.rpcUrls first, registry public default second (dev-only — see rpc.ts).
    return createSolanaRpcClient(solanaRpcUrl(cluster, config.rpcUrls));
  }

  function resolveFetch(): FetchLike {
    // Bound — see evm.ts resolveFetch: an unbound browser fetch throws "Illegal invocation".
    return config.deps?.fetch ?? (globalThis.fetch.bind(globalThis) as unknown as FetchLike);
  }

  /**
   * ONE SIGNER INSTANCE PER ADDRESS. Kit compares signers by IDENTITY, not by address: hand it two
   * different signer objects for the same address and it refuses to sign at all —
   *
   *   "Multiple distinct signers were identified for address <addr>."
   *
   * This function used to mint a fresh signer on every call, so an SPL send produced two: one as the
   * transfer's AUTHORITY (via buildSplTransfer) and one as the self-pay FEE PAYER. Plain SOL sends
   * survived — they only ever need the fee payer — which is exactly why this stayed hidden until a
   * token was sent self-pay.
   */
  const signerCache = new Map<string, TransactionPartialSigner>();
  function solanaSigner(addr: string, cluster: "mainnet" | "devnet"): TransactionPartialSigner {
    const key = `${cluster}:${addr}`;
    const cached = signerCache.get(key);
    if (cached) return cached;
    const signer = toRemoteKitSigner({
      address: addr as never,
      // Forward the resolved cluster so the origin consent view can enrich SPL transfers with
      // the registry token symbol/decimals. Backward-safe: the own-origin signer ignores the opt.
      sign: async (bytes) => base58.decode((await connection.signSolanaTransaction(bytes, { cluster })).signature),
    });
    signerCache.set(key, signer);
    return signer;
  }

  function resolveKora(): KoraClient | undefined {
    if (config.deps?.kora) return config.deps.kora;
    if (!config.koraUrl) return undefined;
    return createKora({ url: config.koraUrl, fetch: resolveFetch() });
  }

  /**
   * Ask the CHAIN what actually happened. Both rails answer the same way now: self-pay broadcast it, and
   * Kora broadcast the sponsored one, so either way we hold a real signature and the chain is the single
   * source of truth. (The bespoke relayer held the transaction under an opaque INTENT id and had to be
   * asked for the signature; that indirection died with it.)
   *
   * A transaction whose blockhash has expired can NEVER land, and must not be left "pending" forever:
   * that is a distinct outcome from failure (it is safe to rebuild and resend) and it is reported as
   * such.
   */
  async function solanaReceiptStatus(receipt: Receipt): Promise<Receipt> {
    if (!receipt.signature) return receipt;
    const rpc = resolveSolanaRpc(receipt.cluster);
    const st = await rpc.getSignatureStatus(receipt.signature);
    if (st?.err != null) return { ...receipt, status: "failed" };
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
      return { ...receipt, status: "confirmed" };
    }
    // Not seen yet. If the blockhash lifetime has lapsed it can never land — say so rather than
    // spinning until the timeout and reporting a pending transaction that is actually dead.
    if (receipt.lastValidBlockHeight !== undefined) {
      const height = await rpc.getBlockHeight();
      if (height > receipt.lastValidBlockHeight) return { ...receipt, status: "expired" };
    }
    // Sponsored stays "pending" until the chain confirms it: Kora accepted it, which is not inclusion.
    return { ...receipt, status: receipt.rail === "sponsored" ? "pending" : "submitted" };
  }

  /** Assemble the (instructions, feePayer, [fee meta]) for a rail. No gesture. */
  async function assemble(
    instructions: Instruction[],
    opts: SolanaTxOpts | undefined,
    cluster: "mainnet" | "devnet",
  ): Promise<{
    allIx: Instruction[];
    feePayer: FeePayer;
    rail: "self-pay" | "sponsored";
    feeToken?: string;
    expectedFee?: bigint;
    /** The FULL priced fee (sponsored). `expectedFee` is only its amount — the consent screen needs the
     *  breakdown, and dropping it here is why the fee read "unavailable". */
    fee?: SolanaFeeBreakdown;
    rpc: SolanaRpcClient;
    computeUnitLimit: number;
    computeUnitPrice: bigint;
  }> {
    const rpc = resolveSolanaRpc(cluster);
    const userAddr = requireSolanaAddress();
    const signer = solanaSigner(userAddr, cluster);
    const feeToken = resolveSolanaFeeToken(cluster, opts);
    const computeUnitLimit = opts?.computeUnitLimit ?? DEFAULT_CU_LIMIT;
    const computeUnitPrice = opts?.computeUnitPrice ?? DEFAULT_CU_PRICE;

    if (!feeToken) {
      return { allIx: instructions, feePayer: { kind: "signer", signer }, rail: "self-pay", rpc, computeUnitLimit, computeUnitPrice };
    }

    // sponsored — but only if a Kora is actually reachable. No Kora ⇒ self-pay: a sponsored attempt on a
    // cluster with no fee payer must degrade, not fail (SPEC-05 §1).
    const kora = resolveKora();
    if (!kora) {
      return { allIx: instructions, feePayer: { kind: "signer", signer }, rail: "self-pay", rpc, computeUnitLimit, computeUnitPrice };
    }

    // Kora is the fee payer. Ask who that is BEFORE building: the transaction cannot be assembled, let
    // alone priced, with an empty feePayer slot.
    const { signer_address: koraSigner } = await kora.getPayerSigner();

    // PRICE THE REAL TRANSACTION. Build it once with the user's instructions and Kora's feePayer, hand
    // those exact bytes to Kora, and append the payment its quote demands.
    //
    // We deliberately do NOT re-derive the fee locally from oracle + rent + signature counts, the way
    // the bespoke relay path did. Kora simulates and prices what it will actually pay — including the
    // rent for any token account this opens — and any number we compute in parallel is one it will
    // disagree with. That disagreement is precisely what made every sponsored send come back
    // `fee_too_low`. One pricer, one number, and it is the one the user signs.
    const probe = await buildSolanaMessage({
      rpc,
      instructions,
      feePayer: { kind: "address", address: koraSigner },
      computeUnitLimit,
      computeUnitPrice,
    });
    const probeB64 = getBase64EncodedWireTransaction(compileTransaction(probe.message as never) as never);

    const { instructions: feeIx, quote } = await buildKoraFeePayment({
      kora,
      rpc,
      txB64: probeB64,
      feeToken,
      from: userAddr,
      authority: signer as never,
      tokenProgram: feeTokenProgram(cluster, feeToken),
      decimals: feeTokenDecimals(cluster, feeToken),
    });

    // The fee transfer goes FIRST: a reader of the signed message should see what they are paying
    // before what they are doing.
    const allIx = [...feeIx, ...instructions];

    // The bounded fee the consent screen shows — and the exact amount the signed bytes transfer. Kora
    // quotes one all-in number, so there is no baseFee/priorityFee/rent split to report (see
    // FeeBreakdown: absent means unknown, never zero).
    const fee: SolanaFeeBreakdown = {
      feeToken,
      amount: quote.feeInToken,
      lamportsTotal: quote.feeInLamports,
    };

    return {
      allIx,
      feePayer: { kind: "address", address: koraSigner },
      rail: "sponsored",
      feeToken,
      expectedFee: quote.feeInToken,
      fee,
      rpc,
      computeUnitLimit,
      computeUnitPrice,
    };
  }

  async function buildResolved(
    instructions: Instruction[],
    opts: SolanaTxOpts | undefined,
    cluster: "mainnet" | "devnet",
  ): Promise<{
    built: Awaited<ReturnType<typeof buildSolanaMessage>>;
    resolved: SolanaResolved;
    rpc: SolanaRpcClient;
    assembled: Awaited<ReturnType<typeof assemble>>;
  }> {
    const a = await assemble(instructions, opts, cluster);
    const built = await buildSolanaMessage({
      rpc: a.rpc,
      instructions: a.allIx,
      feePayer: a.feePayer,
      computeUnitLimit: a.computeUnitLimit,
      computeUnitPrice: a.computeUnitPrice,
    });
    const resolved: SolanaResolved = {
      message: built.message,
      lastValidBlockHeight: built.lastValidBlockHeight,
      cluster,
      rail: a.rail,
      feeToken: a.feeToken,
      expectedFee: a.expectedFee,
    };
    return { built, resolved, rpc: a.rpc, assembled: a };
  }

  return {
    feeTokens(cluster?: string): FeeToken[] {
      const c = resolveCluster(cluster);
      return listFeeTokens()
        .filter((e) => e.chainId === `solana:${c}` && "mint" in e.token)
        .map((e) => {
          const t = e.token as { symbol: string; mint: string; decimals: number; tokenProgram: string };
          return { symbol: t.symbol, mint: t.mint, decimals: t.decimals, tokenProgram: t.tokenProgram };
        });
    },

    async supportedFeeTokens(cluster?: string): Promise<FeeToken[]> {
      const c = resolveCluster(cluster);
      const kora = resolveKora();
      if (!kora) return [];
      const accepted = new Set(await kora.getSupportedTokens());
      // Intersect: an offerable token must be one Kora takes AND one we can describe honestly. A mint
      // with no registry profile has no decimals or symbol, so it can be neither priced nor displayed.
      return this.feeTokens(c).filter((t) => accepted.has(t.mint));
    },

    async buildSplTransfer(args): Promise<Instruction[]> {
      const cluster = resolveCluster(args.cluster);
      const token = getSolanaTokenProfile(cluster, args.mint);
      if (!token) throw new Error(`Unknown SPL mint ${args.mint} on solana:${cluster}`);
      const from = requireSolanaAddress();
      const rpc = resolveSolanaRpc(cluster);
      const authority = solanaSigner(from, cluster);

      // Per-rail create-ATA rent payer. A fee-token mint means sponsored → Kora is the fee payer, so Kora
      // funds the new account (and prices that rent into its quote); self-pay → the user funds it in SOL.
      // No Kora ⇒ the send will fall back to self-pay, so the user is the payer here too.
      let payer = from;
      const feeToken = resolveSolanaFeeToken(cluster, { feeToken: args.feeToken });
      if (feeToken) {
        const kora = resolveKora();
        if (kora) payer = (await kora.getPayerSigner()).signer_address;
      }

      const { instructions } = await buildSplTransfer({
        rpc,
        mint: args.mint,
        from,
        to: args.to,
        amount: args.amount,
        payer,
        authority: authority as never,
        tokenProgram: token.tokenProgram,
        decimals: token.decimals,
      });
      return instructions;
    },

    async simulate(instructions: unknown[], opts?: SolanaTxOpts): Promise<SolanaSimulation> {
      const cluster = resolveCluster(opts?.cluster);
      const { built, resolved, rpc, assembled } = await buildResolved(instructions as Instruction[], opts, cluster);
      // SURFACE THE PRICED FEE. It was computed in assemble(), committed to the fee-transfer
      // instruction the user is about to sign — and then not passed here, so `SimulationResult.fee`
      // was ALWAYS undefined on Solana and every sponsored consent screen read "Transaction fee:
      // unavailable". The number existed the whole time; nobody handed it over.
      const result = await simulateSolanaMessage({
        rpc,
        message: built.message,
        ...(assembled.fee ? { fee: assembled.fee } : {}),
      });

      // SELF-PAY pays in SOL, so there is no priced `fee` to show — and showing nothing was the bug:
      // the consent screen fell back to a raw compute-unit count, which is not a number anyone can
      // consent to. Estimate the real SOL cost (and the create-ATA rent, which dwarfs it).
      const nativeFee =
        resolved.rail === "self-pay"
          ? await estimateSolanaNativeFee({
              rpc,
              cluster,
              instructions: assembled.allIx as unknown as readonly {
                programAddress: string;
                accounts?: readonly { address: string }[];
              }[],
              computeUnitLimit: assembled.computeUnitLimit,
              computeUnitPrice: assembled.computeUnitPrice,
            })
          : undefined;

      return Object.assign(result, { resolved, ...(nativeFee ? { nativeFee } : {}) });
    },

    async wait(receipt: Receipt, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<Receipt> {
      const timeoutMs = opts?.timeoutMs ?? 90_000;
      const intervalMs = opts?.intervalMs ?? 1_500;
      const deadline = Date.now() + timeoutMs;

      let current = receipt;
      for (;;) {
        current = await solanaReceiptStatus(current);
        if (current.status === "confirmed" || current.status === "failed" || current.status === "expired") {
          return current;
        }
        if (Date.now() >= deadline) {
          // Do NOT resolve as confirmed on a timeout. An unconfirmed transaction is exactly the thing
          // a wallet must never round up to success.
          return current;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },

    async send(input: SolanaSimulation | unknown[], opts?: SolanaTxOpts): Promise<Receipt> {
      let resolved: SolanaResolved;
      let rpc: SolanaRpcClient;
      if (Array.isArray(input)) {
        const cluster = resolveCluster(opts?.cluster);
        const b = await buildResolved(input as Instruction[], opts, cluster);
        // Re-sim gate (mirrors EVM send): submit only a message that simulates clean.
        const sim = await simulateSolanaMessage({ rpc: b.rpc, message: b.built.message });
        if (!sim.success) throw new Error(`Solana simulation failed: ${sim.error ?? "unknown"}`);
        resolved = b.resolved;
        rpc = b.rpc;
      } else {
        resolved = input.resolved;
        rpc = resolveSolanaRpc(resolved.cluster);
      }

      if (resolved.rail === "self-pay") {
        return sendSolana({
          rail: "self-pay",
          message: resolved.message,
          lastValidBlockHeight: resolved.lastValidBlockHeight,
          cluster: resolved.cluster,
          rpc,
        });
      }
      const kora = resolveKora();
      if (!kora) throw new Error("sponsored requires koraUrl");
      return sendSolana({
        rail: "sponsored",
        message: resolved.message,
        lastValidBlockHeight: resolved.lastValidBlockHeight,
        cluster: resolved.cluster,
        kora,
      });
    },

    signMessage(message: string): Promise<{ signature: string }> {
      return connection.signSolanaMessage(message);
    },
  };
}
