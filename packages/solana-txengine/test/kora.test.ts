import { describe, it, expect } from "vitest";
import { createKora, KoraRejectedError, type FetchLike } from "../src/kora.js";

/** A fake Kora node. Records the request bodies; replies from a scripted result map. */
function fakeKora(results: Record<string, unknown>, opts?: { error?: { code: number; message: string } }) {
  const calls: { method: string; params: unknown }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init!.body!) as { method: string; params: unknown };
    calls.push({ method: body.method, params: body.params });
    if (opts?.error) return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, error: opts.error }) };
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: results[body.method] }) };
  };
  return { fetch, calls };
}

describe("createKora", () => {
  it("speaks JSON-RPC 2.0 to the configured url", async () => {
    const f = fakeKora({ getSupportedTokens: { tokens: ["MintA", "MintB"] } });
    const kora = createKora({ url: "https://kora.test", fetch: f.fetch });
    expect(await kora.getSupportedTokens()).toEqual(["MintA", "MintB"]);
    expect(f.calls).toEqual([{ method: "getSupportedTokens", params: undefined }]);
  });

  it("getPayerSigner returns the fee payer + the payment destination", async () => {
    const f = fakeKora({ getPayerSigner: { payment_address: "PayHere", signer_address: "KoraSigner" } });
    const kora = createKora({ url: "https://kora.test", fetch: f.fetch });
    expect(await kora.getPayerSigner()).toEqual({ payment_address: "PayHere", signer_address: "KoraSigner" });
  });

  // Kora reports fees as JS `number`s in the token's smallest unit. The repo counts money in bigint —
  // a float that reaches the fee-transfer instruction is a wrong amount the user then signs.
  it("converts the numeric fee fields to bigint at the boundary", async () => {
    const f = fakeKora({
      estimateTransactionFee: {
        fee_in_lamports: 5000,
        fee_in_token: 10456,
        payment_address: "PayHere",
        signer_pubkey: "KoraSigner",
      },
    });
    const kora = createKora({ url: "https://kora.test", fetch: f.fetch });
    const q = await kora.estimateTransactionFee("BASE64TX", "MintA");
    expect(q).toEqual({
      feeInLamports: 5000n,
      feeInToken: 10456n,
      paymentAddress: "PayHere",
      signerPubkey: "KoraSigner",
    });
    expect(f.calls[0]).toEqual({
      method: "estimateTransactionFee",
      params: { transaction: "BASE64TX", fee_token: "MintA" },
    });
  });

  it("signAndSendTransaction returns the broadcast signature", async () => {
    const f = fakeKora({
      signAndSendTransaction: { signature: "SIG123", signed_transaction: "B64", signer_pubkey: "KoraSigner" },
    });
    const kora = createKora({ url: "https://kora.test", fetch: f.fetch });
    expect(await kora.signAndSendTransaction("BASE64TX")).toEqual({ signature: "SIG123" });
  });

  // The bespoke relayer's original sin was throwing away the reason and reporting the bare status, which
  // made every sponsored failure identical and undiagnosable. Kora says WHY in `error.message` — carry it,
  // and phrase it like the EVM paymaster's so `classifySendError` can read one dialect, not two.
  it("carries the reason out of a JSON-RPC error", async () => {
    const f = fakeKora({}, { error: { code: -32602, message: "unsupported_token" } });
    const kora = createKora({ url: "https://kora.test", fetch: f.fetch });
    await expect(kora.getSupportedTokens()).rejects.toThrow(KoraRejectedError);
    await expect(kora.getSupportedTokens()).rejects.toThrow("Paymaster refused the transaction: unsupported_token");
  });

  it("reports an HTTP-layer fault with the url and status", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 502, json: async () => ({}) });
    const kora = createKora({ url: "https://kora.test", fetch });
    await expect(kora.getSupportedTokens()).rejects.toThrow("Kora request failed: https://kora.test → 502");
  });
});
