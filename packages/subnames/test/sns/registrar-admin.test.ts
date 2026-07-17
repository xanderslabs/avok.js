import { describe, expect, test, vi } from "vitest";
import { buildCreateRegistrar, readRegistrarFee } from "../../src/sns/registrar-admin.js";

const OWNER = "36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const { createRegistrarMock, retrieveMock } = vi.hoisted(() => {
  const fakePk = (s: string) => ({ toBase58: () => s });
  return {
    createRegistrarMock: vi.fn(async () => [
      {
        programId: fakePk("So11111111111111111111111111111111111111112"),
        keys: [{ pubkey: fakePk("36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4"), isSigner: true, isWritable: true }],
        data: Buffer.from([7]),
      },
    ]),
    retrieveMock: vi.fn(async () => ({
      mint: fakePk("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      priceSchedule: [{ length: 1, price: 10_000000n }, { length: 2, price: 5_000000n }],
    })),
  };
});
vi.mock("@bonfida/sub-register", () => ({ createRegistrar: createRegistrarMock, Registrar: { retrieve: retrieveMock } }));

describe("SNS registrar admin tooling", () => {
  test("buildCreateRegistrar returns a normalized Solana NameMint", async () => {
    const mint = await buildCreateRegistrar(
      { rpcUrl: "https://api.devnet.solana.com" },
      { domain: "qudi", domainOwner: OWNER, feePayer: OWNER, mint: MINT, authority: OWNER, schedule: [{ length: 1, price: 10_000000n }], feeAccount: OWNER, allowRevoke: true },
    );
    expect(mint.chain).toBe("solana");
    if (mint.chain !== "solana") throw new Error("expected solana");
    expect(mint.instructions.length).toBe(1);
  });

  test("readRegistrarFee returns the fee mint + price schedule", async () => {
    const fee = await readRegistrarFee({ rpcUrl: "https://api.devnet.solana.com" }, "So11111111111111111111111111111111111111112");
    expect(fee.mint).toBe(MINT);
    expect(fee.prices).toEqual([10_000000n, 5_000000n]);
  });
});
