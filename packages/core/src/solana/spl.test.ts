import { describe, expect, it } from "vitest";
import { address, createNoopSigner, partiallySignTransactionMessageWithSigners } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { createWallet } from "../wallet/index.js";
import { associatedTokenAddress, buildSplTransfer } from "./spl.js";
import { buildSolanaMessage } from "./build.js";
import { toKitSigner } from "./signer.js";

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// ── FakePasskeyAdapter (mirrors send.test.ts) ─────────────────────────────────
class FakePasskeyAdapter {
  private readonly credentials = new Map<string, { prfOutput: ArrayBuffer }>();
  private readonly largeBlobs = new Map<string, Uint8Array>();
  private counter = 0;

  async create(_label: string, _address: string) {
    this.counter += 1;
    const credentialId = `fake-cred-${this.counter}`;
    const prfOutput = new Uint8Array(Array.from({ length: 32 }, (_, i) => (this.counter * 17 + i) % 256)).buffer;
    this.credentials.set(credentialId, { prfOutput });
    return {
      credentialId, prfOutput, transports: ["internal"], rpId: "test.local",
      prf: { extension: "prf" as const, saltVersion: "v0" as const },
      platform: { authenticatorAttachment: "platform" as const },
      largeBlobSupported: true,
    };
  }

  async authenticate(credentialId: string): Promise<ArrayBuffer> {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Unknown credential: ${credentialId}`);
    return cred.prfOutput.slice(0); // fresh buffer per call: sandbox zeroes prfOutput (single-use contract)
  }

  async discover(): Promise<never> { throw new Error("not needed"); }
  async supportsLargeBlob(): Promise<boolean> { return true; }
  async writeLargeBlob(credentialId: string, _t: string[] | undefined, bytes: Uint8Array): Promise<boolean> {
    if (!this.credentials.has(credentialId)) return false;
    this.largeBlobs.set(credentialId, bytes);
    return true;
  }
  async readLargeBlob(credentialId: string): Promise<Uint8Array | null> {
    return this.largeBlobs.get(credentialId) ?? null;
  }
}

// ── Shared addresses ──────────────────────────────────────────────────────────
// All addresses are valid 32-byte base58-encoded Solana public keys.
const ADDRS = {
  mint:  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mint
  from:  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",  // token program addr (stand-in owner)
  to:    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // assoc token program addr (stand-in owner)
  payer: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",  // Serum DEX v3 (stand-in payer)
};

// The SOURCE account must exist (we cannot create it — only its owner can fund it) while the
// DESTINATION may not (we create it idempotently). A fake that answered the same for both hid that
// distinction entirely, so resolve the source ATA up front and answer per-address.
const sourceAtaOf = async (mint: string, owner: string) => await associatedTokenAddress(mint, owner);

const fakeRpc = (destPresent: boolean, sourcePresent = true) => {
  const source = sourceAtaOf(ADDRS.mint, ADDRS.from);
  return {
    getAccountInfo: async (addr: string) => ({
      exists: addr === (await source) ? sourcePresent : destPresent,
    }),
  } as never;
};

describe("buildSplTransfer", () => {
  it("emits only a transfer when the destination ATA exists", async () => {
    const authority = createNoopSigner(address(ADDRS.from));
    const { instructions, createdAta } = await buildSplTransfer({ rpc: fakeRpc(true), ...ADDRS, amount: 1000n, authority, decimals: 6 });
    expect(createdAta).toBe(false);
    expect(instructions).toHaveLength(1);
  });

  // The wallet cannot transfer a token it has never held: there is no source account to debit, and we
  // cannot create one (only its owner can fund it). Left to the chain, this surfaced as
  // `InstructionError: [3, "InvalidAccountData"]` — an index into a transaction the user never
  // assembled, naming neither the token nor the actual problem.
  it("fails with a readable error when the wallet has no token account to send FROM", async () => {
    const authority = createNoopSigner(address(ADDRS.from));
    await expect(
      buildSplTransfer({ rpc: fakeRpc(true, false), ...ADDRS, amount: 1000n, authority, decimals: 6 }),
    ).rejects.toThrow(/never held this token|no token account/i);
  });

  it("prepends an idempotent create-ATA when the destination ATA is missing", async () => {
    const authority = createNoopSigner(address(ADDRS.from));
    const { instructions, createdAta } = await buildSplTransfer({ rpc: fakeRpc(false), ...ADDRS, amount: 1000n, authority, decimals: 6 });
    expect(createdAta).toBe(true);
    expect(instructions).toHaveLength(2); // create-ATA, then transfer
    // Assert order: first instruction is ATA-create, last is SPL transfer
    expect((instructions[0] as { programAddress: string }).programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
    expect((instructions[instructions.length - 1] as { programAddress: string }).programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
  });
});

describe("associatedTokenAddress – Token-2022 yields a different ATA than classic", () => {
  it("classic and Token-2022 ATAs for the same mint+owner are distinct addresses", async () => {
    const mint = ADDRS.mint; // USDC mint (any valid mint address works)
    const owner = ADDRS.from;
    const classicAta = await associatedTokenAddress(mint, owner, TOKEN_PROGRAM_ADDRESS);
    const t22Ata = await associatedTokenAddress(mint, owner, TOKEN_2022_PROGRAM);
    expect(classicAta).not.toBe(t22Ata);
    // Both must be valid base58 32-byte pubkey strings
    expect(classicAta.length).toBeGreaterThan(30);
    expect(t22Ata.length).toBeGreaterThan(30);
  });
});

describe("buildSplTransfer – Token-2022 emits transferChecked on Token-2022 program", () => {
  it("with tokenProgram=Token-2022 + decimals, emits a transferChecked instruction targeting Token-2022", async () => {
    const authority = createNoopSigner(address(ADDRS.from));
    const { instructions, createdAta } = await buildSplTransfer({
      rpc: fakeRpc(true), // dest ATA exists; only the transfer instruction is emitted
      ...ADDRS,
      amount: 1000n,
      authority,
      tokenProgram: TOKEN_2022_PROGRAM,
      decimals: 6,
    });
    expect(createdAta).toBe(false);
    expect(instructions).toHaveLength(1);
    // The single instruction must target the Token-2022 program (not the classic Token program)
    const ix = instructions[0] as { programAddress: string };
    expect(ix.programAddress).toBe(TOKEN_2022_PROGRAM);
    // Classic Token program must NOT be used
    expect(ix.programAddress).not.toBe(TOKEN_PROGRAM_ADDRESS);
  });

  it("classic transfer (default tokenProgram) now emits transferChecked encoding the mint + decimals, still targeting the classic Token program", async () => {
    const authority = createNoopSigner(address(ADDRS.from));
    const { instructions } = await buildSplTransfer({
      rpc: fakeRpc(true),
      ...ADDRS,
      amount: 1000n,
      authority,
      decimals: 6,
      // no tokenProgram → defaults to classic
    });
    const ix = instructions[0] as {
      programAddress: string;
      accounts: readonly { address: string }[];
    };
    // Still the classic Token program (transferChecked is a classic-program instruction too).
    expect(ix.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
    // transferChecked accounts: [0]=source, [1]=mint, [2]=destination, [3]=authority.
    // The mint is now encoded (a plain Transfer would carry no mint account) — this is what
    // lets the /sign consent view enrich the fee line.
    expect(ix.accounts).toHaveLength(4);
    expect(ix.accounts[1]?.address).toBe(ADDRS.mint);
  });

  it("throws if a classic SPL transfer is built without providing decimals", async () => {
    const authority = createNoopSigner(address(ADDRS.from));
    await expect(
      buildSplTransfer({
        rpc: fakeRpc(true),
        ...ADDRS,
        amount: 1000n,
        authority,
        // no decimals, classic path — transferChecked now requires it, should throw
      }),
    ).rejects.toThrow(/decimals/i);
  });

  it("throws if Token-2022 is used without providing decimals", async () => {
    const authority = createNoopSigner(address(ADDRS.from));
    await expect(
      buildSplTransfer({
        rpc: fakeRpc(true),
        ...ADDRS,
        amount: 1000n,
        authority,
        tokenProgram: TOKEN_2022_PROGRAM,
        // no decimals — should throw
      }),
    ).rejects.toThrow(/decimals/i);
  });
});

describe("buildSplTransfer – sponsored composition (authority must be a signer)", () => {
  it("user authority slot signed, relayer fee-payer slot null when authority is a TransactionSigner", async () => {
    const passkey = new FakePasskeyAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = toKitSigner({ state, passkey: passkey as any });

    const RELAYER = "So11111111111111111111111111111111111111112";
    const DUMMY_BLOCKHASH = "CSymwgTNX1j3E4qhKfJAUoHTwjMfAnkd9izNNos98opr";

    const compositionRpc = {
      getAccountInfo: async () => ({ exists: true }), // dest ATA already exists; skip create
      getLatestBlockhash: async () => ({ blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 9999n }),
    } as never;

    const { instructions } = await buildSplTransfer({
      rpc: compositionRpc,
      mint: ADDRS.mint,
      from: state.solanaAddress as string,
      to: ADDRS.payer, // any valid recipient address
      amount: 1_000_000n,
      payer: RELAYER,
      authority: signer, // ← user's TransactionSigner; must be non-null after partial sign
      decimals: 6,
    });

    const { message } = await buildSolanaMessage({
      rpc: compositionRpc,
      instructions,
      feePayer: { kind: "address", address: RELAYER },
      computeUnitLimit: 100_000,
      computeUnitPrice: 0n,
    });

    const partial = await partiallySignTransactionMessageWithSigners(message as never);
    const sigs = partial.signatures as Record<string, Uint8Array | null>;

    // User authority slot MUST be signed (the transfer instruction carries the signer)
    expect(sigs[signer.address]).not.toBeNull();
    // Relayer fee-payer slot MUST remain null (relayer co-signs server-side)
    expect(sigs[RELAYER]).toBeNull();
  });
});
