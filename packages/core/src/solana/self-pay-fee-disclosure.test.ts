import { describe, it, expect } from "vitest";
import { estimateSolanaNativeFee, ATA_PROGRAM_ADDRESS, LAMPORTS_PER_SIGNATURE } from "./pricing.js";

/**
 * SELF-PAY ON SOLANA MUST DISCLOSE A COST — and the biggest number in it is not the fee.
 *
 * The consent screen used to say "~15000 compute units (paid in SOL)". A compute-unit count is a
 * machine number; nobody can consent to it. But base + priority fee would ALSO have been wrong: when
 * the recipient has no token account, creating their ATA costs ~2,039,280 lamports of rent — roughly
 * 400x the ~5,000 base fee — and on the self-pay rail the USER funds it.
 *
 * The rent is per-MINT, not per-program. A classic USDC account is 165 bytes; a Token-2022 PYUSD one
 * is 187 (MEASURED by simulating a create-ATA for a fresh owner — reasoning from the TLV layout
 * predicts 182 and is wrong). So the mint is recovered from the instruction and its registry `ataSize`
 * drives the lookup, and an unidentifiable mint fails loud rather than quoting the 165-byte rent for
 * an account that is not 165 bytes.
 */

const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";  // classic  → 165B
const PYUSD_DEVNET = "CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM"; // 2022     → 187B

const RENT_BY_SIZE: Record<number, bigint> = {
  165: 2_039_280n, // verified against devnet
  187: 2_192_400n, // verified against devnet
};

const rpc = {
  getMinimumBalanceForRentExemption: async (space: number) => {
    const r = RENT_BY_SIZE[space];
    if (r === undefined) throw new Error(`unexpected account size ${space}`);
    return r;
  },
} as never;

const TRANSFER_IX = { programAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" };
const createAtaFor = (mint: string) => ({
  programAddress: ATA_PROGRAM_ADDRESS,
  // The real instruction's account list: payer, ata, owner, MINT, systemProgram, tokenProgram.
  accounts: [
    { address: "PayerXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
    { address: "AtaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
    { address: "OwnerXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
    { address: mint },
    { address: "11111111111111111111111111111111" },
  ],
});

const base = { rpc, cluster: "devnet" as const, computeUnitLimit: 200_000, computeUnitPrice: 1_000n };

describe("solana self-pay native fee", () => {
  it("charges base + priority when the recipient already has a token account", async () => {
    const est = await estimateSolanaNativeFee({ ...base, instructions: [TRANSFER_IX] });

    expect(est.baseFee).toBe(LAMPORTS_PER_SIGNATURE); // one signature: payer AND authority
    expect(est.priorityFee).toBe(200n); // 200_000 CU x 1_000 µLamports / 1e6
    expect(est.rent).toBe(0n);
    expect(est.lamports).toBe(est.baseFee + est.priorityFee);
  });

  it("adds the create-ATA rent — the number that dwarfs the fee — when the batch opens an account", async () => {
    const est = await estimateSolanaNativeFee({
      ...base,
      instructions: [createAtaFor(USDC_DEVNET), TRANSFER_IX],
    });

    expect(est.rent).toBe(2_039_280n);
    expect(est.lamports).toBe(est.baseFee + est.priorityFee + est.rent);
    // The whole point: rent is ~400x the fee. Reporting only base+priority would have told the user
    // 0.000005 SOL for a send that actually costs them 0.00204.
    expect(est.rent).toBeGreaterThan((est.baseFee + est.priorityFee) * 100n);
  });

  it("sizes the rent PER MINT — a Token-2022 PYUSD account is 187 bytes, not the classic 165", async () => {
    const usdc = await estimateSolanaNativeFee({ ...base, instructions: [createAtaFor(USDC_DEVNET)] });
    const pyusd = await estimateSolanaNativeFee({ ...base, instructions: [createAtaFor(PYUSD_DEVNET)] });

    // Quoting the classic 165-byte rent for PYUSD would under-state its rent by ~153,120 lamports.
    expect(pyusd.rent).toBe(2_192_400n);
    expect(pyusd.rent).toBeGreaterThan(usdc.rent);
  });

  it("keeps rent SEPARATE from the fee, so a UI cannot silently call a deposit a fee", async () => {
    const est = await estimateSolanaNativeFee({ ...base, instructions: [createAtaFor(USDC_DEVNET)] });
    // Rent is refundable to the RECIPIENT, whose account it funds. It is not the network's fee and it
    // is not gone — it must be nameable on screen as what it is.
    expect(est.baseFee + est.priorityFee).toBeLessThan(est.rent);
  });

  it("prices the priority fee on the REQUESTED compute limit, which is what Solana charges", async () => {
    const est = await estimateSolanaNativeFee({
      ...base, instructions: [TRANSFER_IX], computeUnitLimit: 1_000_000, computeUnitPrice: 2_000n,
    });
    expect(est.priorityFee).toBe(2_000n); // 1e6 CU x 2_000 / 1e6
  });

  it("FAILS LOUD on a create-ATA whose mint it cannot identify, rather than guessing the size", async () => {
    await expect(
      estimateSolanaNativeFee({
        ...base,
        instructions: [{ programAddress: ATA_PROGRAM_ADDRESS, accounts: [{ address: "SomeUnknownMint1111111111111111111111111111" }] }],
      }),
    ).rejects.toThrow(/must not be guessed|no registry mint/i);
  });
});
