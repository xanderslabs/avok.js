import { describe, expect, it } from "vitest";
import { getReceiptStatus } from "../src/track.js";
const rpc = (status: string | null, err: unknown, height: bigint) => ({
  getSignatureStatus: async () => (status ? { confirmationStatus: status, err } : null),
  getBlockHeight: async () => height,
} as never);
const receipt = (sig?: string, lvbh?: bigint) => ({ id: sig ?? "x", rail: "self-pay", status: "submitted", signature: sig, cluster: "devnet", lastValidBlockHeight: lvbh } as never);

describe("getReceiptStatus", () => {
  it("confirmed when the signature is finalized", async () => {
    expect(await getReceiptStatus({ rpc: rpc("finalized", null, 100n), receipt: receipt("sig", 200n) })).toBe("confirmed");
  });
  it("failed when the signature has an error", async () => {
    expect(await getReceiptStatus({ rpc: rpc("processed", { x: 1 }, 100n), receipt: receipt("sig", 200n) })).toBe("failed");
  });
  it("expired (not failed) when unconfirmed past lastValidBlockHeight — safe to rebuild + resend", async () => {
    expect(await getReceiptStatus({ rpc: rpc(null, null, 300n), receipt: receipt("sig", 200n) })).toBe("expired");
  });
  it("pending when unconfirmed and not yet expired", async () => {
    expect(await getReceiptStatus({ rpc: rpc(null, null, 100n), receipt: receipt("sig", 200n) })).toBe("pending");
  });
});
