import { describe, it, expect } from "vitest";
import { base64 } from "@scure/base";
import {
  compileTransaction,
  address,
  AccountRole,
  compressTransactionMessageUsingAddressLookupTables,
} from "@solana/kit";
import { createWallet } from "../../src/wallet/index.js";
import {
  buildSolanaMessage,
  buildSplTransfer,
  associatedTokenAddress,
  toKitSigner,
} from "../../src/solana/index.js";
import { decodeSolanaConsent, formatBaseUnits } from "../../src/auth-popup/sign/solana-consent.js";
import { decodeSignConsent } from "../../src/auth-popup/sign/consent.js";

// ── FakePasskeyAdapter (mirrors solana-txengine test helpers) ─────────────────
class FakePasskeyAdapter {
  private readonly credentials = new Map<string, { prfOutput: ArrayBuffer }>();
  private counter = 0;

  async create(_label: string, _address: string) {
    this.counter += 1;
    const credentialId = `fake-cred-${this.counter}`;
    const prfOutput = new Uint8Array(
      Array.from({ length: 32 }, (_, i) => (this.counter * 17 + i) % 256),
    ).buffer;
    this.credentials.set(credentialId, { prfOutput });
    return {
      credentialId,
      prfOutput,
      transports: ["internal"],
      rpId: "test.local",
      prf: { extension: "prf" as const, saltVersion: "v0" as const },
      platform: { authenticatorAttachment: "platform" as const },
    };
  }

  async authenticate(credentialId: string): Promise<ArrayBuffer> {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Unknown credential: ${credentialId}`);
    return cred.prfOutput;
  }

  async discover(): Promise<never> {
    throw new Error("not needed");
  }
}

// ── Fixture constants ─────────────────────────────────────────────────────────
const DUMMY_BLOCKHASH = "CSymwgTNX1j3E4qhKfJAUoHTwjMfAnkd9izNNos98opr";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC (mainnet registry mint)
const MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // USDC (devnet registry mint)
const RECIPIENT_OWNER = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const AMOUNT = 1_000_000n;

const fakeRpc = {
  getAccountInfo: async () => ({ exists: true }),
  getLatestBlockhash: async () => ({
    blockhash: DUMMY_BLOCKHASH,
    lastValidBlockHeight: 9999n,
  }),
} as never;

async function makeSplFixture() {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  const sponsorAta = await associatedTokenAddress(MINT, RECIPIENT_OWNER);

  const { instructions } = await buildSplTransfer({
    rpc: fakeRpc,
    mint: MINT,
    from: state.solanaAddress as string,
    to: RECIPIENT_OWNER,
    amount: AMOUNT,
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

  const compiled = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  const messageBytes = compiled.messageBytes as unknown as Uint8Array;

  return {
    messageBytes,
    expectedFeePayer: signer.address as string,
    sponsorAta,
    amount: AMOUNT,
  };
}

/** Same SPL transfer, but the mint is compressed into an Address Lookup Table so the compiled
 *  message carries a non-empty `addressTableLookups` — the origin consent path must refuse it. */
async function makeAltFixture(): Promise<Uint8Array> {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  const { instructions } = await buildSplTransfer({
    rpc: fakeRpc, mint: MINT, from: state.solanaAddress as string, to: RECIPIENT_OWNER,
    amount: AMOUNT, payer: state.solanaAddress as string, authority: signer, decimals: 6,
  });
  const { message } = await buildSolanaMessage({
    rpc: fakeRpc, instructions, feePayer: { kind: "signer", signer },
    computeUnitLimit: 100_000, computeUnitPrice: 0n,
  });

  const LOOKUP_TABLE = "SysvarRent111111111111111111111111111111111"; // any valid 32-byte base58
  const compressed = compressTransactionMessageUsingAddressLookupTables(message as never, {
    [LOOKUP_TABLE]: [MINT],
  } as never);
  const compiled = compileTransaction(compressed as Parameters<typeof compileTransaction>[0]);
  return compiled.messageBytes as unknown as Uint8Array;
}

async function makeUnknownProgramFixture() {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  // Memo program — not in our known classification set, so classified as "raw"
  const unknownProgramIx = {
    programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    accounts: [] as never[],
    data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  };

  const { message } = await buildSolanaMessage({
    rpc: fakeRpc,
    instructions: [unknownProgramIx],
    feePayer: { kind: "signer", signer },
    computeUnitLimit: 100_000,
    computeUnitPrice: 0n,
  });

  const compiled = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  const messageBytes = compiled.messageBytes as unknown as Uint8Array;
  return { messageBytes };
}

// Classic SPL Token program. buildSplTransfer now emits a TransferChecked (mint-carrying) for
// classic tokens too, so its fee line enriches. To exercise mint-carrying enrichment in
// isolation we hand-build a TransferChecked whose data layout is:
//   u8 discriminator(=12) ‖ u64 LE amount ‖ u8 decimals.
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TRANSFER_CHECKED_DISCRIMINATOR = 12;
const TRANSFER_DISCRIMINATOR = 3;

async function makeTransferCheckedFixture(mint: string, amount: bigint = AMOUNT) {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  const sourceAta = await associatedTokenAddress(mint, state.solanaAddress as string);
  const destAta = await associatedTokenAddress(mint, RECIPIENT_OWNER);

  const data = new Uint8Array(10);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, TRANSFER_CHECKED_DISCRIMINATOR);
  dv.setBigUint64(1, amount, true);
  dv.setUint8(9, 6); // decimals field (SPL encodes it; consent enrichment reads from the registry)

  // TransferChecked accounts: [0]=source, [1]=mint, [2]=destination, [3]=authority
  const transferCheckedIx = {
    programAddress: address(SPL_TOKEN_PROGRAM),
    accounts: [
      { address: address(sourceAta), role: AccountRole.WRITABLE },
      { address: address(mint), role: AccountRole.READONLY },
      { address: address(destAta), role: AccountRole.WRITABLE },
      { address: signer.address, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };

  const { message } = await buildSolanaMessage({
    rpc: fakeRpc,
    instructions: [transferCheckedIx],
    feePayer: { kind: "signer", signer },
    computeUnitLimit: 100_000,
    computeUnitPrice: 0n,
  });

  const compiled = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  return { messageBytes: compiled.messageBytes as unknown as Uint8Array, mint, destAta };
}

// A raw classic-SPL plain Transfer (discriminator 3), which encodes NO mint. buildSplTransfer no
// longer produces this shape for Avok's own fee transfer, but third-party app-built instructions
// still might, so the unenriched consent path (transfer.mint === "" ⇒ no registry lookup) must
// stay covered. Data layout: u8 discriminator(=3) ‖ u64 LE amount. Accounts: [source, dest, authority].
async function makePlainTransferFixture(mint: string, amount: bigint = AMOUNT) {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  const sourceAta = await associatedTokenAddress(mint, state.solanaAddress as string);
  const destAta = await associatedTokenAddress(mint, RECIPIENT_OWNER);

  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, TRANSFER_DISCRIMINATOR);
  dv.setBigUint64(1, amount, true);

  const plainTransferIx = {
    programAddress: address(SPL_TOKEN_PROGRAM),
    accounts: [
      { address: address(sourceAta), role: AccountRole.WRITABLE },
      { address: address(destAta), role: AccountRole.WRITABLE },
      { address: signer.address, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };

  const { message } = await buildSolanaMessage({
    rpc: fakeRpc,
    instructions: [plainTransferIx],
    feePayer: { kind: "signer", signer },
    computeUnitLimit: 100_000,
    computeUnitPrice: 0n,
  });

  const compiled = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  return { messageBytes: compiled.messageBytes as unknown as Uint8Array, destAta };
}

const NATIVE_RECIPIENT = "GDDMwNyyx8uB6zNqmVXf7JQuq5FVCkXvL8AACX9hyzZ7"; // arbitrary owner
const LAMPORTS = 1_500_000_000n; // 1.5 SOL

async function makeSystemTransferFixture() {
  const passkey = new FakePasskeyAdapter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { state } = await createWallet({ passkey: passkey as any, networkName: "Avok" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signer = toKitSigner({ state, passkey: passkey as any });

  // System Program Transfer: data = u32 LE index(=2) ‖ u64 LE lamports; accounts [from, to].
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true);
  dv.setBigUint64(4, LAMPORTS, true);

  const systemTransferIx = {
    programAddress: address("11111111111111111111111111111111"),
    accounts: [
      { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: address(NATIVE_RECIPIENT), role: AccountRole.WRITABLE },
    ],
    data,
  };

  const { message } = await buildSolanaMessage({
    rpc: fakeRpc,
    instructions: [systemTransferIx],
    feePayer: { kind: "signer", signer },
    computeUnitLimit: 100_000,
    computeUnitPrice: 0n,
  });

  const compiled = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  return { messageBytes: compiled.messageBytes as unknown as Uint8Array };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("formatBaseUnits", () => {
  it("formats fractional amounts precisely", () => {
    expect(formatBaseUnits("1500000", 6)).toBe("1.5");
  });
  it("drops a whole-number fraction (no trailing dot or zero)", () => {
    expect(formatBaseUnits("1000000", 6)).toBe("1");
  });
  it("formats a sub-unit amount with leading zero padding", () => {
    expect(formatBaseUnits("1", 6)).toBe("0.000001");
  });
  it("formats zero", () => {
    expect(formatBaseUnits("0", 6)).toBe("0");
  });
  it("returns the integer unchanged for 0 decimals", () => {
    expect(formatBaseUnits("123", 0)).toBe("123");
  });
  it("keeps every significant fractional digit", () => {
    expect(formatBaseUnits("1234567", 6)).toBe("1.234567");
  });
  it("is precision-safe for base-unit values beyond Number.MAX_SAFE_INTEGER", () => {
    // 9_007_199_254_740_993 = MAX_SAFE_INTEGER + 2; Number() would round this.
    expect(formatBaseUnits("9007199254740993", 6)).toBe("9007199254.740993");
  });
});

describe("decodeSolanaConsent", () => {
  it("refuses an Address-Lookup-Table message (accounts unresolvable from bytes) — origin propagates the throw", async () => {
    const altBytes = await makeAltFixture();
    // The pure decoder rejects...
    expect(() => decodeSolanaConsent(altBytes)).toThrow(/Address Lookup Tables/i);
    // ...and the origin's request dispatcher propagates it rather than rendering a blind view.
    expect(() =>
      decodeSignConsent({ op: "signSolanaTransaction", messageBytesB64: base64.encode(altBytes) }),
    ).toThrow(/Address Lookup Tables/i);
  });

  it("renders an SPL transfer line with destination + amount and the fee payer", async () => {
    const { messageBytes, expectedFeePayer, sponsorAta, amount } = await makeSplFixture();
    const view = decodeSolanaConsent(messageBytes, { cluster: "mainnet-beta" });

    expect(view.feePayer).toBe(expectedFeePayer);
    expect(view.cluster).toBe("mainnet-beta");

    const transfer = view.instructions.find((l) => l.kind === "spl-transfer");
    expect(transfer?.token).toMatchObject({
      destination: sponsorAta,
      amount: amount.toString(),
    });
  });

  it("enriches an SPL TransferChecked with registry symbol/decimals when cluster is known", async () => {
    const { messageBytes } = await makeTransferCheckedFixture(MINT_DEVNET);
    const view = decodeSolanaConsent(messageBytes, { cluster: "devnet" });

    const transfer = view.instructions.find((l) => l.kind === "spl-transfer");
    expect(transfer?.token).toMatchObject({
      mint: MINT_DEVNET,
      symbol: "USDC",
      decimals: 6,
    });
  });

  it("sets a precision-safe human-readable amountDisplay alongside the base-unit amount", async () => {
    const { messageBytes } = await makeTransferCheckedFixture(MINT_DEVNET, 1_500_000n);
    const view = decodeSolanaConsent(messageBytes, { cluster: "devnet" });

    const transfer = view.instructions.find((l) => l.kind === "spl-transfer");
    // Base units MUST remain visible; amountDisplay is the derived human string.
    expect(transfer?.token).toMatchObject({
      mint: MINT_DEVNET,
      amount: "1500000",
      symbol: "USDC",
      decimals: 6,
      amountDisplay: "1.5",
    });
  });

  it("leaves symbol/decimals undefined when no cluster hint is provided (backward-safe)", async () => {
    const { messageBytes } = await makeTransferCheckedFixture(MINT_DEVNET);
    const view = decodeSolanaConsent(messageBytes);

    const transfer = view.instructions.find((l) => l.kind === "spl-transfer");
    expect(transfer?.token?.mint).toBe(MINT_DEVNET);
    expect(transfer?.token?.symbol).toBeUndefined();
    expect(transfer?.token?.decimals).toBeUndefined();
    expect(transfer?.token?.amountDisplay).toBeUndefined();
  });

  it("leaves a plain Transfer (no encoded mint) unenriched even when the cluster is known", async () => {
    const { messageBytes, destAta } = await makePlainTransferFixture(MINT_DEVNET);
    const view = decodeSolanaConsent(messageBytes, { cluster: "devnet" });

    const transfer = view.instructions.find((l) => l.kind === "spl-transfer");
    // Plain Transfer encodes no mint → mint stays "" and no registry enrichment is applied,
    // even though the cluster is a recognised one.
    expect(transfer?.token?.mint).toBe("");
    expect(transfer?.token?.destination).toBe(destAta);
    expect(transfer?.token?.symbol).toBeUndefined();
    expect(transfer?.token?.decimals).toBeUndefined();
    expect(transfer?.token?.amountDisplay).toBeUndefined();
  });

  it("falls back to kind:'raw' with base64 data for an unknown program", async () => {
    const { messageBytes } = await makeUnknownProgramFixture();
    const view = decodeSolanaConsent(messageBytes);
    expect(view.instructions.some((l) => l.kind === "raw" && typeof l.raw === "string")).toBe(true);
  });

  it("surfaces a native SOL transfer's lamports + destination (anti-phishing drain guard)", async () => {
    const { messageBytes } = await makeSystemTransferFixture();
    const view = decodeSolanaConsent(messageBytes);

    const native = view.instructions.find((l) => l.kind === "system-transfer");
    expect(native?.native).toEqual({
      lamports: LAMPORTS.toString(),
      destination: NATIVE_RECIPIENT,
    });
  });

  it("decodeSignConsent dispatches signSolanaTransaction (pure, no gesture)", async () => {
    const { messageBytes } = await makeSplFixture();
    const out = decodeSignConsent({
      op: "signSolanaTransaction",
      messageBytesB64: base64.encode(messageBytes),
    } as never);
    expect(out).toMatchObject({ op: "signSolanaTransaction" });
    // Type-narrow to check the view
    if (out.op === "signSolanaTransaction") {
      expect(out.view.feePayer).toBeDefined();
      expect(Array.isArray(out.view.instructions)).toBe(true);
    }
  });
});
