import { describe, it, expect, vi } from "vitest";
import { createSolanaNamespace } from "../../src/client/solana.js";
import type { Receipt } from "../../src/solana/index.js";

/**
 * NEVER ROUND A TRANSACTION UP TO SUCCESS — the Solana half.
 *
 * The EVM rail learned this already (see never-claim-confirmed.test.ts). Solana had no `wait()` AT
 * ALL, so it could not have obeyed the rule even in principle:
 *
 *   - self-pay → status "submitted": broadcast, NOT mined.
 *   - sponsored  → status "pending", NO signature, and `id` was the relayer's INTENT ID.
 *
 * The demos fired "mined" unless the status was literally "failed", and linked
 * `receipt.signature ?? receipt.id` — so a sponsored transaction the relayer had not even submitted was
 * shown as CONFIRMED above an explorer page reading `Signature "6c8bbfa…" is not valid`. Verified on
 * real hardware, twice.
 *
 * Under Kora (#5) the intent-id indirection is gone — Kora broadcasts, so a sponsored receipt carries a
 * REAL signature from the start. That removes the "linked a non-signature" half of the bug outright,
 * but not the other half: a signature is not a confirmation. Kora accepting a transaction says nothing
 * about inclusion, so `wait()` remains the ONLY producer of "confirmed", and only the CHAIN says so —
 * for both rails now.
 */

const USER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SIG = "5".repeat(88);

function namespaceWith(deps: Record<string, unknown>) {
  return createSolanaNamespace({
    connection: { account: () => ({ solana: { address: USER } }) },
    koraUrl: "https://kora.test",
    deps,
  } as never);
}

const sponsoredReceipt: Receipt = {
  // Kora broadcast it, so the id IS the signature — a real one, linkable from the moment it exists.
  id: SIG,
  rail: "sponsored",
  status: "pending",
  signature: SIG,
  cluster: "devnet",
  lastValidBlockHeight: 200n,
};

const selfPayReceipt: Receipt = {
  id: SIG,
  rail: "self-pay",
  status: "submitted", // broadcast, not mined
  signature: SIG,
  cluster: "devnet",
  lastValidBlockHeight: 200n,
};

describe("solana wait(): sponsored", () => {
  const rpc = (over: Record<string, unknown>) => ({
    solanaRpc: { getSignatureStatus: async () => null, getBlockHeight: async () => 100n, ...over },
  });

  it("resolves confirmed ONLY when the CHAIN says so", async () => {
    const sol = namespaceWith(
      rpc({ getSignatureStatus: async () => ({ confirmationStatus: "confirmed", err: null }) }),
    );

    const final = await sol.wait(sponsoredReceipt, { intervalMs: 1 });

    expect(final.status).toBe("confirmed");
    expect(final.signature).toBe(SIG);
  });

  // Kora accepting a transaction is not inclusion. Handing it off is the moment the wallet is most
  // tempted to declare victory, and the moment it has least earned it.
  it("does NOT claim confirmed while the chain has not seen it, even at the timeout", async () => {
    const sol = namespaceWith(rpc({}));

    const final = await sol.wait(sponsoredReceipt, { timeoutMs: 5, intervalMs: 1 });

    // An unconfirmed transaction is exactly the thing a wallet must never round up to success.
    expect(final.status).toBe("pending");
    expect(final.status).not.toBe("confirmed");
  });

  it("reports an on-chain error as failed", async () => {
    const sol = namespaceWith(
      rpc({ getSignatureStatus: async () => ({ confirmationStatus: null, err: { InstructionError: [0, "Custom"] } }) }),
    );
    expect((await sol.wait(sponsoredReceipt, { intervalMs: 1 })).status).toBe("failed");
  });

  it("reports EXPIRED when the blockhash lapsed — Kora's copy can never land either", async () => {
    const sol = namespaceWith(rpc({ getBlockHeight: async () => 999n })); // > lastValidBlockHeight
    expect((await sol.wait(sponsoredReceipt, { intervalMs: 1 })).status).toBe("expired");
  });
});

describe("solana wait(): self-pay", () => {
  const rpc = (over: Record<string, unknown>) => ({
    solanaRpc: {
      getSignatureStatus: async () => null,
      getBlockHeight: async () => 100n,
      ...over,
    },
  });

  it("confirms only once the chain has confirmed it", async () => {
    const sol = namespaceWith(
      rpc({ getSignatureStatus: async () => ({ confirmationStatus: "confirmed", err: null }) }),
    );
    expect((await sol.wait(selfPayReceipt, { intervalMs: 1 })).status).toBe("confirmed");
  });

  it("reports an on-chain error as failed, not confirmed", async () => {
    const sol = namespaceWith(
      rpc({ getSignatureStatus: async () => ({ confirmationStatus: null, err: { InstructionError: [0, "Custom"] } }) }),
    );
    expect((await sol.wait(selfPayReceipt, { intervalMs: 1 })).status).toBe("failed");
  });

  it("reports EXPIRED when the blockhash lapsed — it can never land, and that is not 'pending'", async () => {
    // A distinct outcome from failure: nothing happened, and it is safe to rebuild and resend. Left as
    // "pending" the UI would spin to a timeout and then tell the user to go check an explorer for a
    // transaction that does not exist.
    const sol = namespaceWith(rpc({ getBlockHeight: async () => 999n })); // > lastValidBlockHeight
    expect((await sol.wait(selfPayReceipt, { intervalMs: 1 })).status).toBe("expired");
  });

  it("stays submitted while the chain has simply not seen it yet", async () => {
    const sol = namespaceWith(rpc({}));
    const final = await sol.wait(selfPayReceipt, { timeoutMs: 5, intervalMs: 1 });
    expect(final.status).toBe("submitted");
    expect(final.status).not.toBe("confirmed");
  });
});
