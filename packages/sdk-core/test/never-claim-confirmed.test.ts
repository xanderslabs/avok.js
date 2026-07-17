import { describe, it, expect, vi } from "vitest";
import type { Address, Hex } from "viem";
import { createEvmNamespace } from "../src/client/evm.js";
import type { Connection } from "../src/types.js";
import { makeFakeRpc } from "./fakes.js";

/**
 * NEVER ROUND A TRANSACTION UP TO SUCCESS.
 *
 * `send()` returns when the transaction is HANDED OFF, not when it lands:
 *   - self-pay → status "submitted", with a REAL txHash (broadcast, not yet mined)
 *   - fronted  → status "pending",  and `id` is the UserOp HASH — NOT a transaction hash. The mined tx
 *     hash only exists once the bundler's `getUserOperationReceipt` returns.
 *
 * The demos treated both as done: they fired "mined" unless the status was literally "failed", and
 * linked `receipt.txHash ?? receipt.id` — so a FRONTED transaction that had not even been submitted
 * was displayed as CONFIRMED, with an explorer link to a userOpHash that does not exist on chain.
 *
 * `wait()` is the only thing allowed to produce "confirmed", and only when the chain (self-pay) or the
 * bundler (fronted) says so.
 */
const WALLET = "0x1111111111111111111111111111111111111111" as const;

/** Each poll pops the next receipt: `null` = still pending; an object = mined. */
function clientWith(receiptSequence: (null | { success: boolean; transactionHash: Hex })[]) {
  let i = 0;
  const bundler = {
    estimateUserOperationGas: vi.fn(),
    sendUserOperation: vi.fn(),
    getUserOperationReceipt: vi.fn(async () => {
      const step = receiptSequence[Math.min(i++, receiptSequence.length - 1)] ?? null;
      return step ? { success: step.success, receipt: { transactionHash: step.transactionHash } } : null;
    }),
  };
  const connection = { account: () => ({ evm: { address: WALLET as Address }, solana: { address: "1" } }), status: () => true } as unknown as Connection;
  return createEvmNamespace({
    connection,
    paymasterUrl: "https://pm.test",
    bundlerUrl: "https://bundler.test",
    deps: { rpc: makeFakeRpc({ delegated: false, nonce: 0 }), bundler: bundler as never },
  });
}

const frontedReceipt = { id: "0xuserophash", rail: "fronted" as const, status: "pending" as const, chainId: 10 };

describe("a handed-off transaction is not a confirmed one", () => {
  it("wait() does NOT report confirmed while the bundler still has no receipt", async () => {
    const client = clientWith([null]);
    const out = await client.wait(frontedReceipt, { timeoutMs: 30, intervalMs: 5 });
    expect(out.status).not.toBe("confirmed"); // ← the bug: this used to be shown as confirmed
    expect(out.txHash).toBeUndefined(); // ← and this used to be linked as a tx hash
  });

  it("wait() reports confirmed ONLY when the bundler produces a real txHash", async () => {
    const hash = "0xabc0000000000000000000000000000000000000000000000000000000000001" as Hex;
    const client = clientWith([null, { success: true, transactionHash: hash }]);
    const out = await client.wait(frontedReceipt, { timeoutMs: 5_000, intervalMs: 5 });
    expect(out.status).toBe("confirmed");
    expect(out.txHash).toBe(hash); // ← a REAL hash, not the userOpHash
    expect(out.txHash).not.toBe(frontedReceipt.id);
  });

  it("a reverted UserOp is 'failed', never confirmed", async () => {
    const hash = "0xdead000000000000000000000000000000000000000000000000000000000001" as Hex;
    const client = clientWith([{ success: false, transactionHash: hash }]);
    const out = await client.wait(frontedReceipt, { timeoutMs: 5_000, intervalMs: 5 });
    expect(out.status).toBe("failed");
  });

  it("a timeout stays unconfirmed — it is never rounded up to success", async () => {
    const client = clientWith([null]);
    const out = await client.wait(frontedReceipt, { timeoutMs: 20, intervalMs: 5 });
    expect(out.status).toBe("pending");
  });
});
