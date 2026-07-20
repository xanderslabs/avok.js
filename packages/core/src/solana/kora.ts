import type { FetchLike } from "../http.js";

/**
 * Kora's wire shapes, DECLARED HERE rather than imported from `@solana/kora`.
 *
 * We never use that package at runtime: its `KoraClient` calls global `fetch` with no injection seam
 * (this package hands a bound `FetchLike` down from `config.deps.fetch` — an unbound browser fetch
 * throws "Illegal invocation"), its `client.js` statically imports node's `crypto` for an optional
 * HMAC we do not use, which a browser bundler cannot resolve, and its index re-exports kit plugins
 * whose peers we do not install. Kora is plain JSON-RPC, so we speak it directly.
 *
 * It was previously a type-only devDependency import, which worked only because the old bundled-dts
 * build inlined these shapes into the published .d.ts. Declaration emit is now plain `tsc`, which
 * would have emitted `import type ... from "@solana/kora"` into published types a consumer does not
 * have installed. Mirroring the four response shapes here is the honest fix, and it is what the
 * comment above always described: the SDK's own types are the source of truth for the wire format.
 *
 * snake_case is Kora's, not ours — these are transport shapes, converted at the edge in `createKora`.
 */
/** Exported because it is the return type of `KoraClient.getPayerSigner`, part of the public surface. */
export interface GetPayerSignerResponse {
  /** Public key of the payment destination. */
  payment_address: string;
  /** Public key of the payer signer. */
  signer_address: string;
}

interface GetSupportedTokensResponse {
  /** Supported token mint addresses. */
  tokens: string[];
}

interface EstimateTransactionFeeResponse {
  /** Transaction fee in lamports. */
  fee_in_lamports: number;
  /** Fee in the requested token, in that token's decimals (e.g. 10^6 for USDC). */
  fee_in_token: number;
  /** Public key of the payment destination. */
  payment_address: string;
  /** Public key of the signer used to estimate the fee. */
  signer_pubkey: string;
}

interface SignAndSendTransactionResponse {
  /** Transaction signature. */
  signature: string;
  /** Base64-encoded signed transaction. */
  signed_transaction: string;
  /** Public key of the signer used to send the transaction. */
  signer_pubkey: string;
}

export type { FetchLike };

/**
 * A refusal Kora EXPLAINED. Phrased exactly like the EVM paymaster's, because `classifySendError`
 * parses that phrasing to turn a machine reason into a sentence a person can act on — one rail must
 * not speak a dialect the other's error handling cannot read.
 */
export class KoraRejectedError extends Error {
  constructor(
    readonly reason: string,
    readonly code: number,
    readonly url: string,
  ) {
    super(`Paymaster refused the transaction: ${reason} (code ${code})`);
    this.name = "KoraRejectedError";
  }
}

export interface KoraFeeQuote {
  feeInLamports: bigint;
  feeInToken: bigint;
  paymentAddress: string;
  signerPubkey: string;
}

export interface KoraClient {
  /** The fee payer (`signer_address`) + where the fee must be paid (`payment_address`). */
  getPayerSigner(): Promise<GetPayerSignerResponse>;
  /** The fee-token options (mint addresses). */
  getSupportedTokens(): Promise<string[]>;
  estimateTransactionFee(txB64: string, feeToken: string): Promise<KoraFeeQuote>;
  /** Kora co-signs as fee payer AND broadcasts. The signature is the receipt id. */
  signAndSendTransaction(txB64: string): Promise<{ signature: string }>;
}

/** Kora reports money as a JS `number`; this repo counts it in bigint. Convert once, at the edge. */
function toBigInt(n: number): bigint {
  if (!Number.isFinite(n)) throw new Error(`Kora returned a non-finite amount: ${n}`);
  return BigInt(Math.round(n));
}

export function createKora({ url, fetch }: { url: string; fetch: FetchLike }): KoraClient {
  async function rpc<T>(method: string, params?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`Kora request failed: ${url} → ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new KoraRejectedError(body.error.message, body.error.code, url);
    return body.result as T;
  }

  return {
    getPayerSigner: () => rpc<GetPayerSignerResponse>("getPayerSigner"),
    async getSupportedTokens() {
      return (await rpc<GetSupportedTokensResponse>("getSupportedTokens")).tokens;
    },
    async estimateTransactionFee(txB64, feeToken) {
      const r = await rpc<EstimateTransactionFeeResponse>("estimateTransactionFee", {
        transaction: txB64,
        fee_token: feeToken,
      });
      return {
        feeInLamports: toBigInt(r.fee_in_lamports),
        feeInToken: toBigInt(r.fee_in_token),
        paymentAddress: r.payment_address,
        signerPubkey: r.signer_pubkey,
      };
    },
    async signAndSendTransaction(txB64) {
      const r = await rpc<SignAndSendTransactionResponse>("signAndSendTransaction", { transaction: txB64 });
      return { signature: r.signature };
    },
  };
}
