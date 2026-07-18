import type {
  EstimateTransactionFeeResponse,
  GetPayerSignerResponse,
  GetSupportedTokensResponse,
  SignAndSendTransactionResponse,
} from "@solana/kora";

/**
 * TYPE-ONLY import, deliberately. `@solana/kora`'s runtime `KoraClient` calls global `fetch` with no
 * injection seam (this package hands a bound `FetchLike` down from `config.deps.fetch` — an unbound
 * browser fetch throws "Illegal invocation"), and its `client.js` statically imports node's `crypto`
 * for an optional HMAC we do not use, which a browser bundler cannot resolve. Its index also re-exports
 * kit plugins whose peers we do not install. Kora is plain JSON-RPC, so we speak it directly and keep
 * the SDK's published types as the source of truth for the wire format.
 */

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

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
