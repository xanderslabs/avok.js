import { describe, it, expect } from "vitest";
import { associatedTokenAddress, type KoraClient } from "@avokjs/solana-txengine";
import { createSolanaNamespace } from "../src/client/solana.js";

// Real registry devnet USDC mint (decimals 6, classic Token program).
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
// Valid 32-byte base58 pubkeys (reused from solana-txengine's spl.test.ts stand-ins).
const USER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const RECIP = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const KORA_SIGNER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // any valid pubkey distinct from USER/programs
const KORA_PAYMENT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WSOL = "So11111111111111111111111111111111111111112"; // not a registry SPL fee token

const fakeKora: KoraClient = {
  getPayerSigner: async () => ({ payment_address: KORA_PAYMENT, signer_address: KORA_SIGNER }),
  getSupportedTokens: async () => [USDC_DEVNET],
  estimateTransactionFee: async () => ({
    feeInLamports: 5_000n,
    feeInToken: 10_456n,
    paymentAddress: KORA_PAYMENT,
    signerPubkey: KORA_SIGNER,
  }),
  signAndSendTransaction: async () => ({ signature: "SIG" }),
};

function fakeConfig(overrides: Record<string, unknown> = {}) {
  return {
    connection: {
      account: () => ({ solana: { address: USER } }),
      signSolanaTransaction: async () => ({ signature: "1".repeat(88) }),
    },
    koraUrl: "https://kora.test",
    deps: {
      // The dest ATA does NOT exist → a create-ATA instruction is prepended (that carries the payer).
      // The SOURCE ATA must exist: a wallet cannot send a token it has never held, and we cannot
      // create its account for it. Answering "missing" for BOTH (as this fake used to) described a
      // wallet that is sending a token it does not own — a state the builder now rejects outright.
      solanaRpc: {
        getAccountInfo: async (addr: string) => ({
          exists: addr === (await associatedTokenAddress(USDC_DEVNET, USER)),
        }),
      },
      kora: fakeKora,
      ...overrides,
    },
  } as never;
}

describe("solana.buildSplTransfer — create-ATA payer per rail", () => {
  // The dest ATA is absent (mock), so instructions[0] is the create-ATA; its first account is the
  // rent payer. That is the account the fee mode governs.
  const ataPayer = (ix: unknown[]) => (ix[0] as { accounts: { address: string }[] }).accounts[0].address;

  it("self-pay: the create-ATA rent payer is the user", async () => {
    const ns = createSolanaNamespace(fakeConfig());
    const ix = await ns.buildSplTransfer({ mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: null });
    expect(ataPayer(ix)).toBe(USER);
  });

  it("sponsored: the create-ATA rent payer is Kora's fee-payer signer", async () => {
    const ns = createSolanaNamespace(fakeConfig());
    const ix = await ns.buildSplTransfer({ mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: USDC_DEVNET });
    expect(ataPayer(ix)).toBe(KORA_SIGNER);
  });

  // A fee token names a rail the operator has not configured, so the send will fall back to self-pay —
  // and the rent payer must fall back with it. Naming an absent sponsor here would build a transaction
  // whose payer slot nobody funds or signs for.
  it("sponsored requested but no Kora configured: the rent payer falls back to the user", async () => {
    const cfg = fakeConfig() as unknown as Record<string, unknown>;
    delete cfg.koraUrl;
    delete (cfg.deps as Record<string, unknown>).kora;

    const ns = createSolanaNamespace(cfg as never);
    const ix = await ns.buildSplTransfer({ mint: USDC_DEVNET, to: RECIP, amount: 1_000_000n, cluster: "devnet", feeToken: USDC_DEVNET });
    expect(ataPayer(ix)).toBe(USER);
  });

  it("throws on a mint the cluster registry does not know", async () => {
    const ns = createSolanaNamespace(fakeConfig());
    await expect(
      ns.buildSplTransfer({ mint: WSOL, to: RECIP, amount: 1n, cluster: "devnet" }),
    ).rejects.toThrow(/unknown|not.*support|Unsupported/i);
  });
});
