import { describe, it, expect } from "vitest";
import { decodeCompiledMessage, classifySplTransfer, TOKEN_2022_PROGRAM_ADDRESS } from "../src/decode.js";
import { getTransferCheckedInstructionDataEncoder } from "@solana-program/token";
import { makeSelfPaySplFixture, makeAltMessageBytes } from "./helpers/solana-fixture.js";

describe("decodeCompiledMessage", () => {
  it("decodes fee payer + instructions from a compiled SPL-transfer message", async () => {
    const { messageBytes, expectedFeePayer, fronterAta, amount } = await makeSelfPaySplFixture();
    const { feePayer, instructions } = decodeCompiledMessage(messageBytes);

    expect(feePayer).toBe(expectedFeePayer);
    const transfers = instructions.map(classifySplTransfer).filter(Boolean);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ destination: fronterAta, amount });
  });

  it("refuses to decode a message that uses Address Lookup Tables (accounts unresolvable from bytes)", async () => {
    const altBytes = await makeAltMessageBytes();
    expect(() => decodeCompiledMessage(altBytes)).toThrow(/Address Lookup Tables/i);
  });

  it("returns null from classifySplTransfer for a non-token instruction", () => {
    const computeIx = {
      programAddress: "ComputeBudget111111111111111111111111111111",
      accounts: [],
      data: new Uint8Array([2, 0]),
    };
    expect(classifySplTransfer(computeIx)).toBeNull();
  });

  it("classifies a Token-2022 transferChecked instruction (shared discriminator)", () => {
    // transferChecked accounts order: [0]=source, [1]=mint, [2]=destination, [3]=authority
    const source = "So11111111111111111111111111111111111111112";
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const destination = "Vote111111111111111111111111111111111111111";
    const authority = "Sysvar1111111111111111111111111111111111111";
    const amount = 1_234_567n;
    const data = new Uint8Array(
      getTransferCheckedInstructionDataEncoder().encode({ amount, decimals: 6 }),
    );

    const ix = { programAddress: TOKEN_2022_PROGRAM_ADDRESS, accounts: [source, mint, destination, authority], data };

    expect(classifySplTransfer(ix)).toEqual({ kind: "transferChecked", source, mint, destination, amount });
  });
});
