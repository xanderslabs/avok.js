import { describe, it, expect } from "vitest";
import { simulateSolana } from "./simulate.js";

/**
 * A FAILING SIMULATION MUST REPORT WHY IT FAILED.
 *
 * The RPC's error objects carry u64s, which the client models as BigInt — and BigInt has no JSON
 * representation, so `JSON.stringify(sim.err)` THREW. The moment a Solana simulation actually failed,
 * that throw replaced the real failure: the user was shown "Do not know how to serialize a BigInt"
 * and the true cause never surfaced anywhere — not on screen, not in the console, not in the logs.
 *
 * An error path that destroys the error is worse than no error path at all.
 */
const rpcThatFails = (err: unknown, logs: string[] | null = null) =>
  ({ simulateTransaction: async () => ({ err, unitsConsumed: 12n, logs }) }) as never;

describe("solana simulation errors survive being reported", () => {
  it("renders an error object containing BigInts instead of throwing on it", async () => {
    // The real shape: an InstructionError whose custom code the RPC hands back as a u64/BigInt.
    const res = await simulateSolana({
      rpc: rpcThatFails({ InstructionError: [1n, { Custom: 6003n }] }),
      base64Tx: "AA==",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("InstructionError");
    expect(res.error).toContain("6003"); // the code a person can actually look up
    expect(res.error).not.toMatch(/serialize a BigInt/i);
  });

  it("falls back to the program logs, which usually say more than the error enum", async () => {
    const res = await simulateSolana({
      rpc: rpcThatFails("", ["Program log: insufficient funds"]),
      base64Tx: "AA==",
    });
    expect(res.error).toContain("insufficient funds");
  });

  it("still reports success as success", async () => {
    const res = await simulateSolana({ rpc: rpcThatFails(null), base64Tx: "AA==" });
    expect(res.success).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

/**
 * "instruction 3" is not a fact anyone can act on.
 *
 * The index is into the FINAL transaction — which the user never assembled and cannot see. It counts
 * two compute-budget instructions and, on the sponsored rail, a fee transfer prepended on their behalf.
 * Reporting the bare index forces the reader to reverse-engineer our assembly order before they can
 * begin debugging. Name the instruction.
 */
describe("a failing instruction is named, not numbered", () => {
  const ORDER = [
    "ComputeBudget111111111111111111111111111111",
    "ComputeBudget111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // 2: the sponsored FEE transfer
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",  // 3: the user's own Token-2022 transfer
  ];

  it("maps the instruction index onto the program that actually failed", async () => {
    const res = await simulateSolana({
      rpc: rpcThatFails({ InstructionError: [3n, "InvalidAccountData"] }),
      base64Tx: "AA==",
      programOrder: ORDER,
    });
    expect(res.error).toContain("InvalidAccountData");
    expect(res.error).toContain("#3");
    expect(res.error).toMatch(/Token-2022/); // the user's transfer, not the fee transfer
  });

  it("leaves the error alone when it has no instruction order to map against", async () => {
    const res = await simulateSolana({
      rpc: rpcThatFails({ InstructionError: [3n, "InvalidAccountData"] }),
      base64Tx: "AA==",
    });
    expect(res.error).toContain("InvalidAccountData");
    expect(res.error).not.toContain("#3");
  });
});
