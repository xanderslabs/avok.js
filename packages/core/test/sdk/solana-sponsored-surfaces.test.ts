import { describe, it, expect } from "vitest";
import { associatedTokenAddress, type KoraClient } from "../../src/solana/index.js";
import { createSolanaNamespace } from "../../src/client/solana.js";

/**
 * The sponsored rail's two standing obligations, now that KORA prices the fee (sub-project #5):
 * the number the user is shown must be the number the signed bytes pay, and it must be Kora's — not
 * one we re-derived beside it.
 */

const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const RECIP = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const KORA_SIGNER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const KORA_PAYMENT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const FEE_IN_TOKEN = 10_456n;
const FEE_IN_LAMPORTS = 2_044_280n;

function fakeKora(over: Partial<KoraClient> = {}): KoraClient {
  return {
    getPayerSigner: async () => ({ payment_address: KORA_PAYMENT, signer_address: KORA_SIGNER }),
    getSupportedTokens: async () => [USDC_DEVNET],
    estimateTransactionFee: async () => ({
      feeInLamports: FEE_IN_LAMPORTS,
      feeInToken: FEE_IN_TOKEN,
      paymentAddress: KORA_PAYMENT,
      signerPubkey: KORA_SIGNER,
    }),
    signAndSendTransaction: async () => ({ signature: "SIGFROMKORA" }),
    ...over,
  };
}

function fakeConfig(overrides: Record<string, unknown> = {}) {
  return {
    connection: {
      account: () => ({ solana: { address: USER } }),
      signSolanaTransaction: async () => ({ signature: "1".repeat(88) }),
    },
    koraUrl: "https://kora.test",
    deps: {
      solanaRpc: {
        // Source ATA exists (the wallet holds the token); destination does not (we create it).
        getAccountInfo: async (addr: string) => ({
          exists: addr === (await associatedTokenAddress(USDC_DEVNET, USER)),
        }),
        getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100n }),
        simulateTransaction: async () => ({ err: null, unitsConsumed: 5_000n, logs: [] }),
        getMinimumBalanceForRentExemption: async () => 2_039_280n,
        getRecentPrioritizationFee: async () => 0n,
        getBlockHeight: async () => 90n,
      },
      kora: fakeKora(),
      ...overrides,
    },
  } as never;
}

describe("solana sponsored: the quoted fee reaches the consent screen", () => {
  it("simulate() surfaces the fee — it is not left undefined", async () => {
    const sol = createSolanaNamespace(fakeConfig());
    const ix = await sol.buildSplTransfer({
      mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: USDC_DEVNET,
    });
    const sim = await sol.simulate(ix as never, { cluster: "devnet", feeToken: USDC_DEVNET });

    // The fee is committed to the fee-transfer instruction the user is about to sign — and was once
    // never passed to the simulation, so `fee` was ALWAYS undefined on Solana and every sponsored consent
    // screen read "Transaction fee: unavailable". The number existed the whole time; nobody handed it over.
    expect(sim.fee).toBeDefined();
    expect(sim.fee!.feeToken).toBe(USDC_DEVNET);
    expect(sim.fee!.amount).toBeGreaterThan(0n);
    // Sponsored commits an exact fee, so there is no native estimate to show alongside it.
    expect(sim.nativeFee).toBeUndefined();
  });

  // THE DISCLOSED FEE IS KORA'S QUOTE — we do not price the sponsored rail ourselves.
  //
  // The bespoke relay path re-derived the fee locally (oracle + rent + signature count) and shipped it
  // alongside the relayer's own pricing. The two disagreed, and the relayer REFUSED: every sponsored send
  // that opened a token account came back `fee_too_low`, the relayer declining to be short ~2,039,280
  // lamports of rent. Kora simulates and prices what it will actually pay, rent included. One pricer,
  // one number, and it is the one the user signs.
  it("discloses Kora's quote verbatim, with no locally re-derived split", async () => {
    const sol = createSolanaNamespace(fakeConfig());
    const ix = await sol.buildSplTransfer({
      mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: USDC_DEVNET,
    });
    const sim = await sol.simulate(ix as never, { cluster: "devnet", feeToken: USDC_DEVNET });
    const fee = sim.fee!;

    expect(fee.amount).toBe(FEE_IN_TOKEN);
    expect(fee.lamportsTotal).toBe(FEE_IN_LAMPORTS);
    expect(sim.resolved.expectedFee).toBe(FEE_IN_TOKEN);

    // Kora quotes ONE all-in number: it IS the fee payer, so it funds the rent and prices it into the
    // quote. A fabricated `rent: 0n` reads as "rent is free" — the exact under-pricing this rail was
    // built to stop. #5 deleted baseFee/priorityFee/rent from FeeBreakdown outright, so the TYPE now
    // forbids a split. This pins the RUNTIME key set, which the type cannot: Kora's quote arrives as
    // parsed JSON, and pricing.ts — one import away — computes precisely those three fields for a
    // SELF-PAY transaction. Wiring that split in here would describe a transaction Kora never priced.
    expect(Object.keys(fee).sort()).toEqual(["amount", "feeToken", "lamportsTotal"]);
  });

  it("pays Kora's payment_address, and Kora's signer is the fee payer", async () => {
    const sol = createSolanaNamespace(fakeConfig());
    const ix = await sol.buildSplTransfer({
      mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: USDC_DEVNET,
    });
    const sim = await sol.simulate(ix as never, { cluster: "devnet", feeToken: USDC_DEVNET });
    expect(sim.resolved.rail).toBe("sponsored");

    // Kora only co-signs a transaction that pays it: the fee transfer must land in the ATA of its
    // payment_address (a different account from its signer — paying the wrong one means it never sees
    // the money and declines to co-sign).
    const paymentAta = await associatedTokenAddress(USDC_DEVNET, KORA_PAYMENT);
    const message = sim.resolved.message as { instructions: readonly { accounts?: readonly { address: string }[] }[] };
    const allAccounts = message.instructions.flatMap((i) => (i.accounts ?? []).map((a) => a.address));
    expect(allAccounts).toContain(paymentAta);
  });
});

describe("solana sponsored: rail selection", () => {
  // A sponsored attempt on a cluster with no fee payer must DEGRADE, not fail (SPEC-05 §1). The user
  // asked to not pay SOL; the honest answer when nobody will front is to self-pay, not to error.
  it("a fee token with no Kora configured falls back to self-pay", async () => {
    const cfg = fakeConfig() as unknown as Record<string, unknown>;
    delete cfg.koraUrl;
    delete (cfg.deps as Record<string, unknown>).kora;

    const sol = createSolanaNamespace(cfg as never);
    const ix = await sol.buildSplTransfer({
      mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: USDC_DEVNET,
    });
    const sim = await sol.simulate(ix as never, { cluster: "devnet", feeToken: USDC_DEVNET });
    expect(sim.resolved.rail).toBe("self-pay");
  });

  it("no fee token is self-pay even when a Kora is configured", async () => {
    const sol = createSolanaNamespace(fakeConfig());
    const ix = await sol.buildSplTransfer({
      mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: null,
    });
    const sim = await sol.simulate(ix as never, { cluster: "devnet" });
    expect(sim.resolved.rail).toBe("self-pay");
  });
});

describe("solana: the fee-token picker asks Kora, not the catalogue", () => {
  it("supportedFeeTokens intersects Kora's tokens with the registry", async () => {
    const kora = fakeKora({ getSupportedTokens: async () => [USDC_DEVNET, "SomeMintTheRegistryDoesNotKnow"] });
    const sol = createSolanaNamespace(fakeConfig({ kora }));

    // Offering a token Kora refuses produces a send that dies at signing for no reason the user can
    // see; offering one the registry cannot describe has no decimals to price or display it with.
    const tokens = await sol.supportedFeeTokens("devnet");
    expect(tokens.map((t) => t.mint)).toEqual([USDC_DEVNET]);
  });

  it("offers nothing when there is no Kora — there is no sponsoring to pick", async () => {
    const cfg = fakeConfig() as unknown as Record<string, unknown>;
    delete cfg.koraUrl;
    delete (cfg.deps as Record<string, unknown>).kora;

    const sol = createSolanaNamespace(cfg as never);
    expect(await sol.supportedFeeTokens("devnet")).toEqual([]);
  });
});

describe("solana: one address yields ONE signer instance", () => {
  it("an SPL self-pay send does not produce two distinct signers for the same address", async () => {
    // Kit compares signers by IDENTITY, not address. A fresh signer object per call meant an SPL send
    // built two for the same wallet — the transfer AUTHORITY and the self-pay FEE PAYER — and kit
    // refused to sign: "Multiple distinct signers were identified for address ...". Plain SOL sends
    // only ever need the fee payer, which is why this hid until a token was sent self-pay.
    const sol = createSolanaNamespace(fakeConfig());

    const ix = await sol.buildSplTransfer({
      mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: null,
    });

    // The transfer instruction's authority signer must be the very same object the client will use as
    // the fee payer. Comparing addresses would pass even with the bug present — identity is the point.
    const transfer = (ix as { accounts?: { address: string; signer?: unknown }[] }[]).at(-1)!;
    const authority = transfer.accounts?.find((a) => a.signer !== undefined)?.signer;
    expect(authority).toBeDefined();

    const again = await sol.buildSplTransfer({
      mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: null,
    });
    const transfer2 = (again as { accounts?: { address: string; signer?: unknown }[] }[]).at(-1)!;
    const authority2 = transfer2.accounts?.find((a) => a.signer !== undefined)?.signer;

    expect(authority2).toBe(authority); // SAME instance, not merely the same address
  });
});
