/**
 * Shared fixture for decode.test.ts: builds a real compiled SPL-transfer message
 * using the S-2b builders and returns the messageBytes that decodeCompiledMessage consumes.
 */
import { compileTransaction, compressTransactionMessageUsingAddressLookupTables } from "@solana/kit";
import { createWallet } from "../../../src/wallet/index.js";
import { buildSplTransfer, associatedTokenAddress } from "../../../src/solana/spl.js";
import { buildSolanaMessage } from "../../../src/solana/build.js";
import { toKitSigner } from "../../../src/solana/signer.js";

// ── FakePasskeyAdapter (mirrors spl.test.ts) ──────────────────────────────────
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
      credentialId,
      prfOutput,
      transports: ["internal"],
      rpId: "test.local",
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

  async discover(): Promise<never> {
    throw new Error("not needed");
  }
  async supportsLargeBlob(): Promise<boolean> {
    return true;
  }
  async writeLargeBlob(credentialId: string, _t: string[] | undefined, bytes: Uint8Array): Promise<boolean> {
    if (!this.credentials.has(credentialId)) return false;
    this.largeBlobs.set(credentialId, bytes);
    return true;
  }
  async readLargeBlob(credentialId: string): Promise<Uint8Array | null> {
    return this.largeBlobs.get(credentialId) ?? null;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const DUMMY_BLOCKHASH = "CSymwgTNX1j3E4qhKfJAUoHTwjMfAnkd9izNNos98opr";
// USDC mint (valid base58 32-byte pubkey; used as the SPL mint in the fixture)
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// A stand-in owner for the destination ATA (Assoc Token Program addr — any valid 32-byte key)
const RECIPIENT_OWNER = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const AMOUNT = 1_000_000n; // 1 USDC (6 decimals)

const fakeRpc = {
  getAccountInfo: async () => ({ exists: true }), // dest ATA exists; skip create
  getLatestBlockhash: async () => ({ blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 9999n }),
} as never;

/**
 * Builds a self-pay SPL-transfer transaction message using the S-2b builders,
 * compiles it, and returns the wire messageBytes alongside fixture metadata.
 *
 * Intended for decode.test.ts — do not use outside of tests.
 */
export async function makeSelfPaySplFixture(): Promise<{
  messageBytes: Uint8Array;
  expectedFeePayer: string;
  sponsorAta: string;
  amount: bigint;
  mint: string;
}> {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  const mint = MINT;
  const amount = AMOUNT;

  // Compute the destination ATA (the address the transfer instruction encodes as destination)
  const sponsorAta = await associatedTokenAddress(mint, RECIPIENT_OWNER);

  const { instructions } = await buildSplTransfer({
    rpc: fakeRpc,
    mint,
    from: state.solanaAddress as string,
    to: RECIPIENT_OWNER,
    amount,
    payer: state.solanaAddress as string,
    authority: signer,
    decimals: 6, // USDC; buildSplTransfer now emits transferChecked for classic too
  });

  const { message } = await buildSolanaMessage({
    rpc: fakeRpc,
    instructions,
    feePayer: { kind: "signer", signer },
    computeUnitLimit: 100_000,
    computeUnitPrice: 0n,
  });

  // compileTransaction encodes the message into the wire format; .messageBytes is what the signer signs
  const compiled = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  const messageBytes = compiled.messageBytes as unknown as Uint8Array;

  return {
    messageBytes,
    expectedFeePayer: signer.address as string,
    sponsorAta,
    amount,
    mint,
  };
}

/**
 * Builds the SAME SPL-transfer message but compresses the mint account into an Address
 * Lookup Table, so the compiled message carries a non-empty `addressTableLookups`. Used to
 * prove decodeCompiledMessage refuses ALT messages (their accounts can't be resolved from
 * bytes alone). Do not use outside of tests.
 */
export async function makeAltMessageBytes(): Promise<Uint8Array> {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  const { instructions } = await buildSplTransfer({
    rpc: fakeRpc,
    mint: MINT,
    from: state.solanaAddress as string,
    to: RECIPIENT_OWNER,
    amount: AMOUNT,
    payer: state.solanaAddress as string,
    authority: signer,
    decimals: 6,
  });
  const { message } = await buildSolanaMessage({
    rpc: fakeRpc,
    instructions,
    feePayer: { kind: "signer", signer },
    computeUnitLimit: 100_000,
    computeUnitPrice: 0n,
  });

  // Move the readonly mint account into a lookup table → the compiled message gains a lookup.
  const LOOKUP_TABLE = "SysvarRent111111111111111111111111111111111"; // any valid 32-byte base58
  const compressed = compressTransactionMessageUsingAddressLookupTables(
    message as never,
    {
      [LOOKUP_TABLE]: [MINT],
    } as never,
  );
  const compiled = compileTransaction(compressed as Parameters<typeof compileTransaction>[0]);
  return compiled.messageBytes as unknown as Uint8Array;
}
