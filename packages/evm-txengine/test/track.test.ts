import { expect, test } from "vitest";
import { getReceiptStatus } from "../src/track.js";
import { FakeRpcClient } from "./fakes.js";

const TX = ("0x" + "ab".repeat(32)) as `0x${string}`;

test("self-pay: maps a mined receipt to confirmed/failed", async () => {
  const rpc = new FakeRpcClient({ receipts: { [TX]: { status: "success", transactionHash: TX } } });
  const out = await getReceiptStatus({ id: TX, rail: "self-pay", status: "submitted", txHash: TX, chainId: 10 }, { rpc });
  expect(out.status).toBe("confirmed");

  const rpc2 = new FakeRpcClient({ receipts: { [TX]: { status: "reverted", transactionHash: TX } } });
  const out2 = await getReceiptStatus({ id: TX, rail: "self-pay", status: "submitted", txHash: TX, chainId: 10 }, { rpc: rpc2 });
  expect(out2.status).toBe("failed");
});

test("self-pay: not yet mined stays submitted", async () => {
  const rpc = new FakeRpcClient();
  const out = await getReceiptStatus({ id: TX, rail: "self-pay", status: "submitted", txHash: TX, chainId: 10 }, { rpc });
  expect(out.status).toBe("submitted");
});

test("self-pay: receipt with no txHash is returned unchanged", async () => {
  const rpc = new FakeRpcClient();
  const receipt = { id: "tx_1", rail: "self-pay" as const, status: "submitted" as const, chainId: 10 };
  const out = await getReceiptStatus(receipt, { rpc });
  expect(out).toBe(receipt);
  expect(out.status).toBe("submitted");
});

// Sponsored (4337) receipts are tracked through the bundler (eth_getUserOperationReceipt) in the SDK's
// wait(), NOT here — so getReceiptStatus leaves a sponsored receipt untouched.
test("sponsored: returned unchanged (tracked via the bundler, not this poller)", async () => {
  const rpc = new FakeRpcClient();
  const receipt = { id: "0xuserophash", rail: "sponsored" as const, status: "pending" as const, chainId: 10 };
  const out = await getReceiptStatus(receipt, { rpc });
  expect(out).toBe(receipt);
});
