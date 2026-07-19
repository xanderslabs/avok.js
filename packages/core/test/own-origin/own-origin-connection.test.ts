import { describe, it, expect } from "vitest";
import { verifyMessage, verifyTypedData, recoverAddress, type Address } from "viem";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { encodeOffchainMessage } from "../../src/solana/index.js";
import { getAvokUserOpHash, type AvokUserOperation, type Call } from "../../src/evm/index.js";
import { createOwnOriginConnection } from "../../src/own-origin/connection.js";
import { makeFakePasskey, ACCESS_SLOT_WRITER } from "../client/fakes.js";

describe("createOwnOriginConnection.create", () => {
  it("creates a wallet with zero chain/server calls and exposes the address", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const acct = await conn.create();
    expect(acct.evm.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(conn.status()).toBe(true);
    expect(conn.account()?.evm.address).toBe(acct.evm.address);
    expect(conn.canExport).toBe(true);
  });

  it("account() returns { evm, solana } after create", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "avok.test", passkey });
    const acct = await conn.create();
    expect(acct.evm.address).toMatch(/^0x/);
    expect(acct.solana.address.length).toBeGreaterThan(30);
    expect(conn.account()).toEqual(acct);
  });
});

describe("createOwnOriginConnection operatorName label", () => {
  // operatorName is the cosmetic friendly name: it prefixes the passkey wallet LABEL
  // ("<operatorName> Wallet · Nickname") and falls back to rpId when unset. This asserts the
  // label the wallet-core create() ceremony receives — the string the OS/keychain shows the user.
  it("uses operatorName as the wallet-label prefix when provided", async () => {
    const passkey = makeFakePasskey("acme.test");
    const conn = createOwnOriginConnection({ rpId: "acme.test", operatorName: "Qudi", passkey });
    await conn.create();
    expect(passkey.createdLabels).toHaveLength(1);
    // Non-vacuous: if the `?? opts.rpId` fallback were `opts.rpId` unconditionally, the label would
    // start "acme.test Wallet · …" and this assertion would fail.
    expect(passkey.createdLabels[0]).toMatch(/^Qudi Wallet · /);
    expect(passkey.createdLabels[0]).not.toContain("acme.test");
  });

  it("falls back to rpId as the wallet-label prefix when operatorName is unset", async () => {
    const passkey = makeFakePasskey("acme.test");
    const conn = createOwnOriginConnection({ rpId: "acme.test", passkey });
    await conn.create();
    expect(passkey.createdLabels[0]).toMatch(/^acme\.test Wallet · /);
  });
});

describe("createOwnOriginConnection.export", () => {
  it("exports the FULL wallet after create — BOTH raw chain keys, never just the EVM key", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    await conn.create();
    const exported = await conn.export();
    // A dual-chain wallet must surface BOTH raw keys. There is deliberately NO mnemonic: no standard
    // derivation path reproduces our HKDF(PRF) chain, so a phrase would look restorable and restore
    // nothing. The keys are raw, importable into MetaMask/Phantom.
    expect(exported.evm).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(exported.solana).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect("phrase" in exported).toBe(false);
    expect(conn.status()).toBe(true); // export is a copy, not a logout
  });

  it("export throws before any wallet exists", async () => {
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    await expect(conn.export()).rejects.toThrow();
  });
});

describe("createOwnOriginConnection.continue", () => {
  it("continue() on a primary re-derives the SAME wallet with no network — the passkey IS the wallet", async () => {
    const passkey = makeFakePasskey();
    const created = await createOwnOriginConnection({ rpId: "qudi.fi", passkey }).create();
    // Fresh connection instance, same passkey. Inject an anchor vault that THROWS if read: a primary
    // must reconstruct K = HKDF(PRF) offline and never touch it.
    const b = createOwnOriginConnection({
      rpId: "qudi.fi",
      passkey,
      anchorVault: { getAccessSlot: async () => { throw new Error("primary must not read the vault"); } },
    });
    const acct = await b.continue();
    expect(acct.evm.address).toBe(created.evm.address);
    expect(acct.solana.address).toBe(created.solana.address);
    expect(b.status()).toBe(true);
  });
});

describe("createOwnOriginConnection.logout", () => {
  it("logout() clears state and status() returns false", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    await conn.create();
    expect(conn.status()).toBe(true);
    await conn.logout();
    expect(conn.status()).toBe(false);
    expect(conn.account()).toBeNull();
  });
});

describe("createOwnOriginConnection signing verbs", () => {
  it("signMessage produces a signature recoverable to the wallet", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const { evm: { address } } = await conn.create();
    const signature = await conn.signMessage({ message: "hello avok" });
    expect(await verifyMessage({ address, message: "hello avok", signature })).toBe(true);
  });

  it("signTypedData produces a signature verifiable with verifyTypedData", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const { evm: { address } } = await conn.create();
    const domain = { name: "Test", version: "1", chainId: 1 } as const;
    const types = { Foo: [{ name: "bar", type: "string" }] } as const;
    const message = { bar: "hello avok" } as const;
    const typedData = { domain, types, primaryType: "Foo" as const, message };
    const signature = await conn.signTypedData(typedData);
    expect(await verifyTypedData({ address, ...typedData, signature })).toBe(true);
  });

  it("signSiwe returns a message containing the wallet address and a recoverable signature", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const { evm: { address } } = await conn.create();
    const params = {
      domain: "qudi.fi",
      uri: "https://qudi.fi",
      version: "1" as const,
      nonce: "abc123456",
      chainId: 1,
    };
    const { message, signature } = await conn.signSiwe(params);
    expect(message).toContain(address);
    expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
    // Verify the signature recovers to the wallet address (not just a hex check).
    expect(await verifyMessage({ address: address as Address, message, signature })).toBe(true);
  });

  it("signAuthorization returns the expected {address,chainId,nonce,r,s,yParity} shape", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    await conn.create();
    const delegateTo = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;
    const auth = { chainId: 1, address: delegateTo, nonce: 0 };
    const result = await conn.signAuthorization(auth);
    expect(result).toHaveProperty("address", delegateTo);
    expect(result).toHaveProperty("chainId", 1);
    expect(result).toHaveProperty("nonce", 0);
    expect(result.r).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(result.s).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(result.yParity).toBeTypeOf("number");
  });

  // signUserOp is the 4337 sponsored composite: ONE gesture yields the raw ecrecover signature over the
  // v0.8 userOpHash (what validateUserOp checks) and, when undelegated, the 7702 authorization.
  function makeUserOp(sender: Address): AvokUserOperation {
    return {
      sender,
      nonce: 0n,
      callData: "0xdeadbeef",
      callGasLimit: 100000n,
      verificationGasLimit: 100000n,
      preVerificationGas: 50000n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 1000000000n,
      signature: "0x",
    };
  }

  it("signUserOp signs the userOpHash so it recovers to the wallet address", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const { evm: { address } } = await conn.create();
    const op = makeUserOp(address as Address);

    const { signature, authorization } = await conn.signUserOp({ userOp: op, chainId: 10 });

    const hash = getAvokUserOpHash(op, 10);
    expect(await recoverAddress({ hash, signature })).toBe(address);
    expect(authorization).toBeUndefined(); // delegated case: no authorization requested
  });

  it("signUserOp also returns the 7702 authorization when undelegated (one gesture)", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const { evm: { address } } = await conn.create();
    const op = makeUserOp(address as Address);
    const delegate = "0x1234567890123456789012345678901234567890" as const;

    const { signature, authorization } = await conn.signUserOp({
      userOp: op,
      chainId: 10,
      authorization: { chainId: 10, address: delegate, nonce: 0 },
    });

    const hash = getAvokUserOpHash(op, 10);
    expect(await recoverAddress({ hash, signature })).toBe(address);
    expect(authorization?.address).toBe(delegate);
    expect(authorization?.nonce).toBe(0);
  });
});

describe("createOwnOriginConnection Solana signing verbs", () => {
  // No import path exists: with a seed-derived wallet you cannot inject a chosen Solana key. Instead
  // the wallet's Solana public key IS its address, so decode base58(account.solana) and verify the
  // signature against that — a self-consistent proof that the signer holds the wallet's Solana key.

  it("signSolanaTransaction signs raw bytes and signature verifies against the wallet solana key", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const { solana: { address } } = await conn.create();
    const solanaPub = base58.decode(address);

    const messageBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await conn.signSolanaTransaction(messageBytes);

    // Must be a base58 string (non-empty, alphanumeric base58 charset)
    expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    // consent is undefined in own-origin mode
    expect(result.consent).toBeUndefined();
    // Signature must verify against the wallet's solana public key
    const sigBytes = base58.decode(result.signature);
    expect(ed25519.verify(sigBytes, messageBytes, solanaPub)).toBe(true);
  });

  it("signSolanaMessage signs a UTF-8 string and signature verifies against the wallet solana key", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey });
    const { solana: { address } } = await conn.create();
    const solanaPub = base58.decode(address);

    const message = "hello solana";
    const result = await conn.signSolanaMessage(message);

    expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    const sigBytes = base58.decode(result.signature);
    // Verify against the full v0 envelope for this connection's rpId; raw bytes would now fail.
    expect(ed25519.verify(sigBytes, encodeOffchainMessage({ message, rpId: "qudi.fi" }), solanaPub)).toBe(true);
  });
});

describe("createOwnOriginConnection.addPasskey", () => {
  it("enrols a secondary and writes its ciphertext slot as a self-call on the anchor chain", async () => {
    const passkey = makeFakePasskey("localhost");
    const conn = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    const { evm: { address } } = await conn.create();
    expect(conn.passkeyCount()).toBe(1);

    const submitted: { calls: Call[]; chainId: number }[] = [];
    const ctx = {
      submit: async (calls: Call[], o: { chainId: number }) => { submitted.push({ calls, chainId: o.chainId }); return { id: "tx-add" }; },
      hasSlot: async (): Promise<boolean> => false,
      assertCanAffordAccessSlot: async (): Promise<void> => {},
      ...ACCESS_SLOT_WRITER,
    };

    const r = await conn.addPasskey(ctx);
    expect(r.passkeyCount).toBe(2);
    expect(conn.passkeyCount()).toBe(2);
    expect(r.txId).toBe("tx-add");
    expect(r.slotId).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // Ported from the deleted own-origin-access-slot.test.ts: the write is a self-call on the anchor chain.
    expect(submitted).toHaveLength(1);
    expect(submitted[0].chainId).toBe(10);
    expect(submitted[0].calls[0].to.toLowerCase()).toBe(address.toLowerCase()); // self-call: to == wallet
    expect(submitted[0].calls[0].data.length).toBeGreaterThan(10);

    // The original passkey (slot 1, the primary) still signs to the same address after enrolment.
    const sig = await conn.signMessage({ message: "after addPasskey" });
    expect(await verifyMessage({ address, message: "after addPasskey", signature: sig })).toBe(true);
  });

  it("is idempotent — a slot already on chain writes nothing (txId 'noop'), but enrolment still counts", async () => {
    const passkey = makeFakePasskey("localhost");
    const conn = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    await conn.create();
    const submitted: Call[] = [];
    const ctx = {
      submit: async (calls: Call[], _o: { chainId: number }) => { submitted.push(...calls); return { id: "tx-add" }; },
      hasSlot: async (): Promise<boolean> => true, // slot already stored on chain
      assertCanAffordAccessSlot: async (): Promise<void> => {},
      ...ACCESS_SLOT_WRITER,
    };
    const r = await conn.addPasskey(ctx);
    expect(submitted).toHaveLength(0);
    expect(r.txId).toBe("noop");
    expect(r.passkeyCount).toBe(2);
  });

  it("throws when no wallet is active", async () => {
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey() });
    const ctx = { submit: async () => ({ id: "x" }), hasSlot: async () => false, assertCanAffordAccessSlot: async () => {}, ...ACCESS_SLOT_WRITER,
    ...ACCESS_SLOT_WRITER, ...ACCESS_SLOT_WRITER };
    await expect(conn.addPasskey(ctx)).rejects.toThrow(/no wallet active/i);
  });
});
