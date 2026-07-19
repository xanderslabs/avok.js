import { describe, expect, it } from "vitest";
import { simulateSolana, simulateSolanaMessage } from "../../src/solana/simulate.js";
import { buildSolanaMessage } from "../../src/solana/build.js";

const rpc = (err: unknown, units: bigint) =>
  ({ simulateTransaction: async () => ({ err, unitsConsumed: units, logs: [] }) }) as never;

describe("simulateSolana", () => {
  it("maps a successful sim to success + computeUnits + exact confidence", async () => {
    const r = await simulateSolana({ rpc: rpc(null, 4200n), base64Tx: "AA==" });
    expect(r.success).toBe(true);
    expect(r.computeUnits).toBe(4200n);
    expect(r.confidence).toBe("exact");
  });
  it("maps a failed sim to success:false with an error", async () => {
    const r = await simulateSolana({ rpc: rpc({ InstructionError: [0, "Custom"] }, 0n), base64Tx: "AA==" });
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("simulateSolanaMessage", () => {
  it("compiles an unsigned message and simulates it", async () => {
    const fakeRpc = {
      simulateTransaction: async (b64: string) => {
        expect(typeof b64).toBe("string");
        return { err: null, unitsConsumed: 42n, logs: [] };
      },
      getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000n }),
    } as never;
    const { message } = await buildSolanaMessage({
      rpc: fakeRpc,
      instructions: [],
      feePayer: { kind: "address", address: "11111111111111111111111111111112" },
      computeUnitLimit: 200000,
      computeUnitPrice: 1000n,
    });
    const res = await simulateSolanaMessage({ rpc: fakeRpc, message });
    expect(res.success).toBe(true);
    expect(res.computeUnits).toBe(42n);
  });
});
