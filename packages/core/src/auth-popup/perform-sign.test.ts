import { describe, it, expect, vi } from "vitest";
import { base58, base64 } from "@scure/base";
import { recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getUserOperationHash, entryPoint08Address } from "viem/account-abstraction";
import { parseSiweMessage } from "viem/siwe";
import { performSign, type SignKeys } from "./sign/perform-sign.js";
import type { WalletState } from "../wallet/index.js";

// A real viem account — so signatures are genuinely verifiable, not stubbed.
const evm = privateKeyToAccount(`0x${"11".repeat(32)}`);

// Fake Solana signer: records the exact bytes it was asked to sign.
function fakeSolana() {
  const signed: Uint8Array[] = [];
  return {
    signed,
    signer: {
      address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      sign: vi.fn(async (bytes: Uint8Array) => {
        signed.push(bytes);
        return new Uint8Array(64).fill(7); // deterministic 64-byte "signature"
      }),
    },
  };
}

function keysWith(solana: ReturnType<typeof fakeSolana>["signer"]): SignKeys {
  return { evm, solana } as unknown as SignKeys;
}

const STATE = { evmAddress: evm.address, solanaAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } as unknown as WalletState;
const RP_ID = "qudi.fi";

describe("performSign — the shared-origin money path (browser-side, one gesture)", () => {
  it("signMessage → { signature } recoverable to the wallet's own address", async () => {
    const s = fakeSolana();
    const out = (await performSign({ op: "signMessage", message: "hello" }, keysWith(s.signer), STATE, RP_ID)) as { signature: `0x${string}` };
    expect(out.signature).toMatch(/^0x[0-9a-f]+$/i);
    const { verifyMessage } = await import("viem");
    expect(await verifyMessage({ address: evm.address, message: "hello", signature: out.signature })).toBe(true);
  });

  it("signSiwe builds the message from the WALLET's address (not a caller-supplied one) and signs it", async () => {
    const s = fakeSolana();
    const params = { domain: "qudi.fi", uri: "https://qudi.fi", version: "1", chainId: 1, nonce: "abc123def" } as const;
    const out = (await performSign({ op: "signSiwe", params }, keysWith(s.signer), STATE, RP_ID)) as { message: string; signature: `0x${string}` };
    const parsed = parseSiweMessage(out.message);
    expect(parsed.address?.toLowerCase()).toBe(evm.address.toLowerCase());
    const { verifyMessage } = await import("viem");
    expect(await verifyMessage({ address: evm.address, message: out.message, signature: out.signature })).toBe(true);
  });

  it("signTransaction returns the RAW hex (not wrapped) — the client returns it directly", async () => {
    const s = fakeSolana();
    const out = await performSign(
      { op: "signTransaction", tx: { to: evm.address, value: 1n, chainId: 10, type: "eip1559" } },
      keysWith(s.signer),
      STATE,
      RP_ID,
    );
    expect(typeof out).toBe("string");
    expect(out as string).toMatch(/^0x[0-9a-f]+$/i);
  });

  it("signAuthorization returns the RAW signed authorization object", async () => {
    const s = fakeSolana();
    const out = (await performSign(
      { op: "signAuthorization", authorization: { chainId: 10, address: evm.address, nonce: 3 } },
      keysWith(s.signer),
      STATE,
      RP_ID,
    )) as { r: string; s: string; yParity: number };
    expect(out.r).toMatch(/^0x/);
    expect(out.s).toMatch(/^0x/);
    expect(typeof out.yParity).toBe("number");
  });

  it("signSolanaTransaction signs the EXACT decoded message bytes and returns base58", async () => {
    const s = fakeSolana();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const out = (await performSign(
      { op: "signSolanaTransaction", messageBytesB64: base64.encode(bytes) },
      keysWith(s.signer),
      STATE,
      RP_ID,
    )) as { signature: string; consent: unknown };
    expect(s.signed[0]).toEqual(bytes); // signed precisely what was sent — no re-encoding drift
    expect(base58.decode(out.signature)).toHaveLength(64);
  });

  it("signSolanaMessage domain-separates: it must NOT sign the bare message bytes", async () => {
    const s = fakeSolana();
    const message = "hello from avok";
    const out = (await performSign({ op: "signSolanaMessage", message }, keysWith(s.signer), STATE, RP_ID)) as { signature: string };
    const bare = new TextEncoder().encode(message);
    // The signed payload is the offchain-message envelope, NOT the raw string — a signature over
    // attacker-chosen raw bytes could otherwise be replayed as a transaction.
    expect(s.signed[0]).not.toEqual(bare);
    expect(s.signed[0].length).toBeGreaterThan(bare.length);
    expect(base58.decode(out.signature)).toHaveLength(64);
  });

  it("signTypedData → { signature }", async () => {
    const s = fakeSolana();
    const typedData = {
      domain: { name: "Avok", version: "1", chainId: 1 },
      types: { Msg: [{ name: "content", type: "string" }] },
      primaryType: "Msg",
      message: { content: "hi" },
    } as const;
    const out = (await performSign({ op: "signTypedData", typedData }, keysWith(s.signer), STATE, RP_ID)) as { signature: string };
    expect(out.signature).toMatch(/^0x[0-9a-f]+$/i);
  });
});

/**
 * COMPOSITE OPS — two signatures under the ONE gesture the caller already performed.
 *
 * `performSign` is deliberately gesture-free: the popup does a single `withDiscoveredKeys` and hands
 * the keys in. So signing twice HERE costs the user nothing extra. Sent as separate
 * signAuthorization + signTransaction requests they were two popups and two biometric prompts for a
 * single "Send" — and they cannot be a generic batch, because the transaction EMBEDS the signed
 * authorization.
 */
describe("composite ops — two signatures, one gesture", () => {
  const state = { evmAddress: evm.address } as unknown as WalletState;
  const AUTH = { chainId: 10, address: "0x2222222222222222222222222222222222222222" as const, nonce: 3 };

  it("signSend embeds the signed authorization into the transaction it returns", async () => {
    const solana = fakeSolana();
    const keys = { evm, solana: solana.signer } as unknown as SignKeys;

    const raw = (await performSign(
      { op: "signSend", tx: { chainId: 10, to: evm.address, value: 0n, data: "0x", nonce: 1, gas: 21000n }, authorization: AUTH },
      keys,
      state,
      "acme.test",
    )) as `0x${string}`;

    // A type-4 (EIP-7702) transaction — it carries the authorizationList, which only exists because
    // the SAME gesture signed the authorization first.
    expect(raw.startsWith("0x04")).toBe(true);
  });

  it("signSend with NO authorization signs an ordinary transaction (already delegated)", async () => {
    const solana = fakeSolana();
    const keys = { evm, solana: solana.signer } as unknown as SignKeys;

    const raw = (await performSign(
      { op: "signSend", tx: { chainId: 10, to: evm.address, value: 0n, data: "0x", nonce: 1, gas: 21000n, type: "eip1559" } },
      keys,
      state,
      "acme.test",
    )) as `0x${string}`;

    expect(raw.startsWith("0x02")).toBe(true); // type-2, no delegation
  });

  it("signSponsored returns the batch signature AND the signed authorization", async () => {
    const solana = fakeSolana();
    const keys = { evm, solana: solana.signer } as unknown as SignKeys;
    const typedData = {
      domain: { name: "AvokWallet", version: "1", chainId: 10, verifyingContract: evm.address },
      types: { T: [{ name: "x", type: "uint256" }] },
      primaryType: "T",
      message: { x: 1n },
    };

    const out = (await performSign({ op: "signSponsored", typedData, authorization: AUTH }, keys, state, "acme.test")) as {
      signature: `0x${string}`;
      authorization?: { address: string; nonce: number };
    };

    expect(out.signature.startsWith("0x")).toBe(true);
    // Both signatures came from one gesture.
    expect(out.authorization?.address).toBe(AUTH.address);
    expect(out.authorization?.nonce).toBe(AUTH.nonce);
  });

  // signUserOp — the 4337 sponsored money path. The origin recomputes the v0.8 userOpHash from the
  // supplied fields (never trusts a caller-supplied hash) and signs it RAW (ecrecover-style — the
  // contract's validateUserOp checks `ecrecover(userOpHash, sig) == address(this)`).
  const USEROP = {
    sender: evm.address,
    nonce: 0n,
    callData: "0xdeadbeef" as const,
    callGasLimit: 100000n,
    verificationGasLimit: 100000n,
    preVerificationGas: 50000n,
    maxFeePerGas: 1000000000n,
    maxPriorityFeePerGas: 1000000000n,
    signature: "0x" as const,
  };

  it("signUserOp signs the RECOMPUTED userOpHash (recoverable to the wallet key) + returns the authorization", async () => {
    const keys = { evm, solana: fakeSolana().signer } as unknown as SignKeys;

    const out = (await performSign({ op: "signUserOp", userOp: USEROP as never, chainId: 10, authorization: AUTH }, keys, state, "acme.test")) as {
      signature: `0x${string}`;
      authorization?: { address: string; nonce: number };
    };

    const expectedHash = getUserOperationHash({
      chainId: 10,
      entryPointAddress: entryPoint08Address,
      entryPointVersion: "0.8",
      userOperation: USEROP as never,
    });
    // The signature must recover to the wallet key over the hash the ORIGIN computed — proving the
    // signed hash is derived from the fields the consent screen shows, not a caller-supplied digest.
    expect(await recoverAddress({ hash: expectedHash, signature: out.signature })).toBe(evm.address);
    expect(out.authorization?.address).toBe(AUTH.address);
    expect(out.authorization?.nonce).toBe(AUTH.nonce);
  });

  it("signUserOp for a delegated wallet omits the authorization", async () => {
    const keys = { evm, solana: fakeSolana().signer } as unknown as SignKeys;

    const out = (await performSign({ op: "signUserOp", userOp: USEROP as never, chainId: 10 }, keys, state, "acme.test")) as {
      signature: `0x${string}`;
      authorization?: unknown;
    };

    expect(out.signature.startsWith("0x")).toBe(true);
    expect(out.authorization).toBeUndefined();
  });
});
