import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { buildSolanaMessage } from "../../src/solana/build.js";

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const DUMMY_BLOCKHASH = "CSymwgTNX1j3E4qhKfJAUoHTwjMfAnkd9izNNos98opr";

const fakeRpc = {
  getLatestBlockhash: async () => ({ blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 1000n }),
} as never;

const userInstr = {
  programAddress: address("11111111111111111111111111111111"),
  accounts: [],
  data: new Uint8Array(0),
};

describe("buildSolanaMessage", () => {
  it("sponsored: fee payer is the provided address (no signer on feePayer)", async () => {
    const feePayerAddr = "So11111111111111111111111111111111111111112";
    const { message, lastValidBlockHeight } = await buildSolanaMessage({
      rpc: fakeRpc,
      instructions: [userInstr],
      feePayer: { kind: "address", address: feePayerAddr },
      computeUnitLimit: 200_000,
      computeUnitPrice: 1000n,
    });
    const msg = message as { feePayer: { address: string; signTransactions?: unknown }; instructions: { programAddress: string }[] };
    expect(msg.feePayer.address).toBe(feePayerAddr);
    // bare address: no signTransactions
    expect("signTransactions" in msg.feePayer).toBe(false);
    expect(lastValidBlockHeight).toBe(1000n);
  });

  it("self-pay: fee payer is the signer's address (signer on feePayer)", async () => {
    const signerAddr = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    const fakeSigner = { address: signerAddr, signTransactions: async () => [] };
    const { message } = await buildSolanaMessage({
      rpc: fakeRpc,
      instructions: [userInstr],
      feePayer: { kind: "signer", signer: fakeSigner as never },
      computeUnitLimit: 200_000,
      computeUnitPrice: 1000n,
    });
    const msg = message as { feePayer: { address: string; signTransactions?: unknown }; instructions: { programAddress: string }[] };
    expect(msg.feePayer.address).toBe(signerAddr);
    // signer feePayer: has signTransactions
    expect(typeof msg.feePayer.signTransactions).toBe("function");
  });

  it("compute-budget instructions are prepended before user instructions", async () => {
    const feePayerAddr = "So11111111111111111111111111111111111111112";
    const { message } = await buildSolanaMessage({
      rpc: fakeRpc,
      instructions: [userInstr],
      feePayer: { kind: "address", address: feePayerAddr },
      computeUnitLimit: 200_000,
      computeUnitPrice: 1000n,
    });
    const msg = message as { instructions: { programAddress: string }[] };
    expect(msg.instructions.length).toBe(3); // limit + price + user
    expect(msg.instructions[0].programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
    expect(msg.instructions[1].programAddress).toBe(COMPUTE_BUDGET_PROGRAM);
    expect(msg.instructions[2].programAddress).toBe("11111111111111111111111111111111");
  });
});
