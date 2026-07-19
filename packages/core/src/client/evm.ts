import type { Address, Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import { createPublicClient, http } from "viem";
import type { SiweParams, SignedAuthorizationLike } from "../channel/index.js";
import { evmRpcUrl } from "@avokjs/contracts";
import {
  buildSelfPayCalldata,
  selfPayFees,
  createBundler,
  createPaymaster7677,
  createViemRpcClient,
  getChainProfile,
  listFeeTokens,
  simulateResolved,
  getReceiptStatus,
  type Bundler,
  type Call,
  type EvmChainProfile,
  type ExecutionContext,
  type Paymaster7677,
  type ResolvedBatch,
  type SimulationResult,
  type Receipt,
  type RpcClient,
  type ViemLike,
} from "../evm/index.js";
import { leanResolve } from "./resolve.js";
import {
  prepareSponsoredUserOp,
  boundedSponsoredFee,
  type SponsoredInfra,
  type PreparedSponsoredUserOp,
} from "./sponsored-userop.js";
import { randomNonceAllocator } from "../nonce.js";
import { UnsupportedFeeTokenError } from "./fee-token-error.js";
import type { ClientConfig, ScopedSigner } from "../types.js";

export type TxOpts = { chainId?: number; feeToken?: Address | null };

/** A supported EVM fee token for a chain — the EVM mirror of Solana's `FeeToken`. */
export interface EvmFeeToken {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface EvmNamespace {
  /** Registry's supported fee tokens for `chainId` (required — chains are referenced per call). */
  feeTokens(chainId: number): EvmFeeToken[];
  simulate(calls: Call[], opts?: TxOpts): Promise<SimulationResult>;
  send(input: SimulationResult | Call[], opts?: TxOpts): Promise<Receipt>;
  /**
   * WAIT FOR THE CHAIN TO AGREE. `send()` returns as soon as the transaction is HANDED OFF — a
   * self-pay receipt is `submitted` (broadcast, not mined) and a sponsored receipt is `pending` with
   * the relayer's INTENT ID, which is not a transaction hash and will never appear on any explorer.
   *
   * Nothing may be shown to a user as "confirmed" until this resolves with `confirmed`. The demos
   * used to fire "mined" the moment send() returned, so a sponsored transaction that had not been
   * submitted at all was reported as confirmed, with an explorer link to the intent id.
   */
  wait(receipt: Receipt, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<Receipt>;
  signMessage(a: { message: string }): Promise<Hex>;
  signTypedData(a: TypedDataDefinition): Promise<Hex>;
  signSiwe(p: SiweParams): Promise<{ message: string; signature: Hex }>;
  signAuthorization(a: { chainId: number; address: Address; nonce: number }): Promise<SignedAuthorizationLike>;
  signTransaction(tx: TransactionSerializable): Promise<Hex>;
}

export function makeViemRpc(rpcUrl: string): RpcClient {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return createViemRpcClient(client as unknown as ViemLike);
}

// Default intent-nonce allocator: random 256-bit, stateless (L2-friendly). Operators opt into
// sequential clustering for L1 via config.nonceAllocator (see nonce.ts / the A8 analysis).
const DEFAULT_NONCE_ALLOCATOR = randomNonceAllocator();

/** Chains are referenced per call — there is no client-level default. Fail loud when omitted. */
export function resolveChainId(chainId: number | undefined): number {
  if (chainId === undefined) throw new Error("chainId is required (pass it per call)");
  return chainId;
}

export function resolveRpc(config: ClientConfig, chainId: number): RpcClient {
  if (config.deps?.rpc) return config.deps.rpc;
  // config.rpcUrls first, registry public default second (dev-only — see rpc.ts).
  return makeViemRpc(evmRpcUrl(chainId, config.rpcUrls));
}

export function requireChain(config: ClientConfig, chainId: number): EvmChainProfile {
  // Test seam: allow injecting a chain override (e.g. to set a non-zero canonicalImplementation).
  if (config.deps?.chain) return config.deps.chain;
  const chain = getChainProfile(chainId);
  if (!chain) throw new Error(`Unknown chainId: ${chainId}`);
  return chain;
}

/**
 * An access-slot write, resolved WITHOUT the wallet key. Opaque to callers — hand it back to `signAccessSlotWrite`
 * and `broadcastAccessSlotWrite` unchanged.
 */
export type PreparedAccessSlotWrite = {
  rpc: RpcClient;
  batch: ResolvedBatch;
  txNonce: number;
  /** The tip the CHAIN suggested (`eth_maxPriorityFeePerGas`) — what to bid. Not `eth_gasPrice`,
   *  which is base + a suggested tip and so bids the base fee twice if used as a tip. */
  suggestedTip: Awaited<ReturnType<RpcClient["getMaxPriorityFeePerGas"]>>;
  /** The chain's base fee — the price it actually charges. Not derivable from gasPrice. */
  baseFee: Awaited<ReturnType<RpcClient["getBaseFeePerGas"]>>;
};

// Access-slot writes are SELF-PAY (SPEC §5: internal management writes default to self-pay). The
// sponsored rail is now a 4337 UserOp, which the three-phase key-isolated writer does not use.
export type SignedAccessSlotWrite = { rail: "self-pay"; raw: Hex };

/** The three-phase access-slot writer. See `AccessSlotWriter` on AccessCtx for why it is split this way. */
export type AccessSlotWriter = {
  prepare(probe: Call[], chainId: number): Promise<PreparedAccessSlotWrite>;
  sign(p: PreparedAccessSlotWrite, calls: Call[], signer: ScopedSigner): Promise<SignedAccessSlotWrite>;
  broadcast(p: PreparedAccessSlotWrite, signed: SignedAccessSlotWrite): Promise<{ id: string }>;
};

export function createEvmNamespace(config: ClientConfig): EvmNamespace & { readonly __accessSlot: AccessSlotWriter } {
  const { connection, paymasterUrl, bundlerUrl, deps } = config;
  const deadlineWindowSeconds = BigInt(config.defaultDeadlineSeconds ?? 3600);

  function requireAddress(): Address {
    const address = connection.account()?.evm.address;
    if (!address) throw new Error("no active account");
    return address;
  }

  /** Sponsored (4337) needs BOTH a 7677 paymaster and a bundler. Without both, a send self-pays. */
  function canSponsor(): boolean {
    return Boolean((paymasterUrl || deps?.paymaster) && (bundlerUrl || deps?.bundler));
  }

  /** The bring-your-own 4337 infra for a sponsored send on `rpc`. Only called when `canSponsor()`. */
  function sponsoredInfra(rpc: RpcClient): SponsoredInfra {
    const bundler: Bundler = deps?.bundler ?? createBundler({ url: bundlerUrl! });
    const paymaster: Paymaster7677 = deps?.paymaster ?? createPaymaster7677({ url: paymasterUrl! });
    return { rpc, bundler, paymaster };
  }

  /** Prepare the sponsored UserOp (nonce + 7677 handshake + gas estimate). ALL IO, NO KEY — shared by
   *  `simulate` (to price the bounded fee) and `send` (to sign it). Only called when `canSponsor()`. */
  async function prepareSponsored(rpc: RpcClient, batch: ResolvedBatch): Promise<PreparedSponsoredUserOp> {
    const [suggestedTip, baseFee] = await Promise.all([rpc.getMaxPriorityFeePerGas(), rpc.getBaseFeePerGas()]);
    return prepareSponsoredUserOp(sponsoredInfra(rpc), {
      sender: batch.walletAddress,
      calls: batch.userCalls,
      chainId: batch.chainId,
      feeToken: batch.feeToken ?? null,
      ...(batch.authorization ? { authorization: batch.authorization } : {}),
      suggestedTip,
      baseFee,
    });
  }

  /** Registry's supported fee tokens for `chainId` (required — chains are referenced per call). */
  function feeTokens(chainId: number): EvmFeeToken[] {
    const id = resolveChainId(chainId);
    return listFeeTokens()
      .filter((e) => e.chainId === `eip155:${id}` && "address" in e.token)
      .map((e) => {
        const t = e.token as { symbol: string; address: Address; decimals: number };
        return { symbol: t.symbol, address: t.address, decimals: t.decimals };
      });
  }

  function resolveFeeToken(chainId: number, opts?: TxOpts): Address | null {
    // Fee-token is PER-SEND — there is no client-level default (SPEC §5). Absent/null ⇒ self-pay.
    const token = opts && "feeToken" in opts ? (opts.feeToken ?? null) : null;
    if (!token) return null;
    // No 4337 infra on this deployment (no bundler+paymaster) ⇒ a sponsored attempt falls back to
    // self-pay (SPEC §1: "self-pay everywhere; sponsored only where a bundler+paymaster exist"). Don't
    // validate/forward the token — the chain will simply be paid in native.
    if (!canSponsor()) return null;
    // A fee token is an ERC-20 address, and addresses are chain-specific. Validate against the
    // TARGET chain's registry tokens — never forward a token that means nothing here.
    if (!feeTokens(chainId).some((t) => t.address.toLowerCase() === token.toLowerCase())) {
      throw new UnsupportedFeeTokenError(token, chainId);
    }
    return token;
  }

  /** Resolve a fresh ResolvedBatch from raw calls (delegation + userCalls; the 4337 paymaster prices
   *  the sponsored fee, so nothing is priced here). */
  async function buildBatch(
    calls: Call[],
    chain: EvmChainProfile,
    rpc: RpcClient,
    feeToken: Address | null,
  ): Promise<ResolvedBatch> {
    const address = requireAddress();
    const ctx: ExecutionContext = { chainId: chain.chainId, feeToken };
    const nonce = await (config.nonceAllocator ?? DEFAULT_NONCE_ALLOCATOR).next(address);
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + deadlineWindowSeconds;
    return leanResolve({ rpc, chain, address, userCalls: calls, ctx, nonce, deadline });
  }

  /**
   * THE ACCESS-SLOT WRITER — one user action, ONE passkey gesture.
   *
   * Enrolment needs the wallet key TWICE: to seal the access slot's blob, and to sign the transaction that
   * carries it. Done naively that is two key scopes and two biometric prompts for one "add this
   * device". It cannot simply be wrapped in one scope, because the sealed blob determines the
   * calldata, the calldata determines the transaction, and building the transaction needs chain IO —
   * and K must never be live across a network round-trip.
   *
   * What makes the split possible: THE ACCESS-SLOT-WRITE CALLDATA IS A FIXED LENGTH. `BLOB_BYTES` (61) and
   * `META_BYTES` (93) are constants — the metadata plaintext is deliberately zero-padded to a constant
   * "so the ciphertext size leaks nothing". So a probe call of the same shape resolves to the same
   * nonce, the same delegation and the same gas as the real one, WITHOUT the key.
   *
   *   prepare()   → IO, no key   (resolve against the probe)
   *   sign()      → key, no IO   (seal + sign inside the caller's single scope)
   *   broadcast() → IO, no key
   *
   * Self-pay is exactly equivalent: `leanResolve`'s only IO is getCode/getTransactionCount, neither of
   * which reads `userCalls` — they are copied verbatim into the batch. Sponsored estimates gas over the
   * calldata, which is the same length either way; any residual drift lands inside the relayer's
   * existing tolerance band.
   */
  const __accessSlot: AccessSlotWriter = {
    async prepare(probe: Call[], chainId: number): Promise<PreparedAccessSlotWrite> {
      const id = resolveChainId(chainId);
      const chain = requireChain(config, id);
      const rpc = resolveRpc(config, id);
      const batch = await buildBatch(probe, chain, rpc, resolveFeeToken(id));
      const txNonce = await rpc.getTransactionCount(batch.walletAddress);
      const [suggestedTip, baseFee] = await Promise.all([rpc.getMaxPriorityFeePerGas(), rpc.getBaseFeePerGas()]);
      return { rpc, batch, txNonce, suggestedTip, baseFee };
    },

    /** PURE — no IO. Runs inside the caller's single key scope. */
    async sign(p: PreparedAccessSlotWrite, calls: Call[], signer: ScopedSigner): Promise<SignedAccessSlotWrite> {
      // Substituting userCalls is sound because the probe is the same LENGTH (see above), so every
      // resolved field — authorization, nonce, fee — is the one the real calls would have produced.
      // Access-slot writes are self-pay (SPEC §5), so there is only the self-pay signing path here.
      const batch: ResolvedBatch = { ...p.batch, userCalls: calls };

      const commonFields = {
        chainId: batch.chainId,
        to: batch.walletAddress,
        data: buildSelfPayCalldata(batch),
        value: 0n,
        nonce: p.txNonce,
        // Flat cap here, unlike send(), and deliberately: an access-slot write's gas is dominated by SSTOREs
        // whose cost depends on the VALUE written, not the calldata length. The probe this batch was
        // resolved against carries a placeholder blob, so its simulated gas can be an order of
        // magnitude under the real (non-zero, cold) write — 2,200 vs ~22,100 per word. Deriving a
        // tight limit from that estimate would produce out-of-gas transactions, and an out-of-gas
        // transaction still costs the user the fee. Keep the generous cap.
        gas: 1_000_000n,
        ...selfPayFees(p.suggestedTip, p.baseFee),
      };
      if (batch.authorization) {
        // Self-sponsoring invariant: the authorization is signed over txNonce + 1 (see send()).
        const signedAuth = await signer.signAuthorization({
          chainId: batch.authorization.chainId,
          address: batch.authorization.address,
          nonce: p.txNonce + 1,
        });
        return {
          rail: "self-pay",
          raw: await signer.signTransaction({ ...commonFields, type: "eip7702", authorizationList: [signedAuth] }),
        };
      }
      return { rail: "self-pay", raw: await signer.signTransaction({ ...commonFields, type: "eip1559" }) };
    },

    async broadcast(p: PreparedAccessSlotWrite, signed: SignedAccessSlotWrite): Promise<{ id: string }> {
      return { id: await p.rpc.sendRawTransaction(signed.raw) };
    },
  };

  return {
    __accessSlot,

    async wait(receipt: Receipt, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<Receipt> {
      const timeoutMs = opts?.timeoutMs ?? 90_000;
      const intervalMs = opts?.intervalMs ?? 1_500;
      const rpc = resolveRpc(config, receipt.chainId);
      const deadline = Date.now() + timeoutMs;

      let current = receipt;
      for (;;) {
        if (current.rail === "sponsored") {
          // 4337: track the UserOp through the bundler (`eth_getUserOperationReceipt`). Its `id` is the
          // userOpHash, not a tx hash — the mined tx hash only appears in the receipt once included.
          // Without a bundler configured there is nothing to poll; return the pending receipt as-is.
          if (canSponsor()) {
            const rcpt = await sponsoredInfra(rpc).bundler.getUserOperationReceipt(current.id as Hex);
            if (rcpt) {
              current = {
                ...current,
                status: rcpt.success ? "confirmed" : "failed",
                txHash: rcpt.receipt.transactionHash,
                ...(rcpt.success ? {} : { error: "UserOperation reverted on-chain" }),
              };
            }
          }
        } else {
          current = await getReceiptStatus(current, { rpc });
        }
        if (current.status === "confirmed" || current.status === "failed") return current;
        if (Date.now() >= deadline) {
          // Do NOT resolve as confirmed on a timeout. An unconfirmed transaction is exactly the thing
          // a wallet must never round up to success.
          return current;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
    feeTokens,
    signMessage: (a) => connection.signMessage(a),
    signTypedData: (a) => connection.signTypedData(a),
    signSiwe: (p) => connection.signSiwe(p),
    signAuthorization: (a) => connection.signAuthorization(a),
    signTransaction: (tx) => connection.signTransaction(tx),

    async simulate(calls, opts?) {
      const chainId = resolveChainId(opts?.chainId);
      const chain = requireChain(config, chainId);
      const rpc = resolveRpc(config, chainId);
      const feeToken = resolveFeeToken(chainId, opts);
      const batch = await buildBatch(calls, chain, rpc, feeToken);
      const sim = await simulateResolved(batch, { rpc, chain });

      // SPONSORED: run the 7677 handshake now so the consent screen shows the BOUNDED fee the send will
      // sign (sign-what-you-saw), and carry the prepared UserOp so `send` signs that exact op rather
      // than re-preparing (a fresh estimate could disagree with what the user saw). The fee is derived
      // from the prepared op's gas ceiling only when the token is known; a single-token paymaster (null
      // feeToken) discloses no amount here.
      if (batch.rail === "sponsored" && canSponsor()) {
        const preparedUserOp = await prepareSponsored(rpc, batch);
        const fee = batch.feeToken ? boundedSponsoredFee(preparedUserOp.op, batch.feeToken) : undefined;
        return { ...sim, ...(fee ? { fee } : {}), preparedUserOp };
      }
      return sim;
    },

    async send(input, opts?) {
      // Sign-what-you-saw: a prior SimulationResult reuses its resolved batch/chain
      // verbatim (signed bytes == simulated bytes). Raw calls resolve fresh.
      let batch: ResolvedBatch;
      let chain: EvmChainProfile;
      let rpc: RpcClient;
      // A prior sponsored SimulationResult carries the prepared UserOp; reuse it so the signed op is the
      // exact one the user was quoted (sign-what-you-saw), never a fresh estimate.
      let reusedUserOp: PreparedSponsoredUserOp | undefined;
      if (Array.isArray(input)) {
        const chainId = resolveChainId(opts?.chainId);
        chain = requireChain(config, chainId);
        rpc = resolveRpc(config, chainId);
        const feeToken = resolveFeeToken(chainId, opts);
        batch = await buildBatch(input, chain, rpc, feeToken);
      } else {
        batch = input.batch;
        chain = requireChain(config, batch.chainId);
        rpc = resolveRpc(config, batch.chainId);
        reusedUserOp = (input as SimulationResult & { preparedUserOp?: PreparedSponsoredUserOp }).preparedUserOp;
      }

      if (batch.rail === "sponsored" && canSponsor()) {
        // 4337 sponsored send: build a UserOp whose callData is the user's batch, sponsor it via the
        // ERC-7677 paymaster, and submit through the bundler. ALL IO (nonce, 7677 handshake, gas
        // estimate, fee prices) happens BEFORE the single passkey gesture — the key must never be live
        // across a network round-trip. A reused SimulationResult skips the handshake entirely.
        const infra = sponsoredInfra(rpc);
        const prepared = reusedUserOp ?? (await prepareSponsored(rpc, batch));
        // ONE gesture: the raw userOpHash signature and, if undelegated, the 7702 authorization the
        // first sponsored send installs. viem forwards `op.authorization` as the UserOp's eip7702Auth.
        const { signature, authorization } = await connection.signUserOp({
          userOp: prepared.op,
          chainId: prepared.chainId,
          ...(prepared.authorization ? { authorization: prepared.authorization } : {}),
        });
        prepared.op.signature = signature;
        if (authorization) prepared.op.authorization = authorization;
        const id = await infra.bundler.sendUserOperation(prepared.op);
        return { id, rail: "sponsored", status: "pending", chainId: batch.chainId };
      }
      // A sponsored batch on a chain without 4337 infra falls through to self-pay (SPEC §1).

      // self-pay: the wallet EOA is both authority AND tx sender.
      const txNonce = await rpc.getTransactionCount(batch.walletAddress);
      const [suggestedTip, baseFee] = await Promise.all([rpc.getMaxPriorityFeePerGas(), rpc.getBaseFeePerGas()]);

      // Gas limit from the estimate the batch was resolved with, doubled for headroom.
      //
      // This used to be a flat 1_000_000 — roughly 20× a token transfer. Nobody was overcharged for the
      // slack (EIP-1559 refunds unused gas), so it looked harmless. It was not: `gas × maxFeePerGas` is
      // the MOST the signature can cost, it is the only fee fact derivable from the signed bytes, and it
      // is therefore exactly what a signing surface must disclose. A 20× cap made that disclosure
      // useless — "at most 0.09 USDC" for a transaction that costs 0.0046.
      //
      // 2× headroom, not 1.2×: self-pay is the one rail nobody re-estimates downstream (the relayer
      // re-estimates the sponsored rail authoritatively), and an out-of-gas transaction still costs the
      // user the fee. Overshooting the limit is free; undershooting it is not.
      const gasLimit = batch.nativeFee ? batch.nativeFee.gasUnits * 2n : 1_000_000n;

      const commonFields = {
        chainId: batch.chainId,
        to: batch.walletAddress,
        data: buildSelfPayCalldata(batch),
        value: 0n,
        nonce: txNonce,
        gas: gasLimit,
        ...selfPayFees(suggestedTip, baseFee),
      };

      // ONE gesture. All IO (nonce, gas price) is done ABOVE, deliberately: the key is live only for
      // the duration of this callback. An undelegated wallet needs the 7702 authorization AND the
      // transaction; signing them through the connection's individual verbs opened two key scopes, so
      // a single "Send" asked the user for a fingerprint twice.
      // Self-sponsoring invariant: EIP-7702 validates the outer tx nonce first (N → N+1), then processes
      // the authorization against the now-incremented account nonce. When the wallet is both authority
      // AND sender, the authorization MUST be signed over txNonce + 1, not txNonce.
      // One gesture on BOTH rails — the signer embeds the signed authorization for us.
      const serialized: Hex = await connection.signSend({
        tx: { ...commonFields, type: "eip1559" },
        ...(batch.authorization
          ? {
              authorization: {
                chainId: batch.authorization.chainId,
                address: batch.authorization.address,
                nonce: txNonce + 1,
              },
            }
          : {}),
      });

      const txHash = await rpc.sendRawTransaction(serialized);
      return { id: txHash, rail: "self-pay", status: "submitted", txHash, chainId: batch.chainId };
    },
  };
}
