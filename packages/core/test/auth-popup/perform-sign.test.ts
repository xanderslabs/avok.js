import { describe, it, expect } from "vitest";
import { recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getUserOperationHash, entryPoint09Address } from "viem/account-abstraction";
import { parseSiweMessage } from "viem/siwe";
import { performSign, type SignKeys } from "../../src/auth-popup/sign/perform-sign.js";
import type { WalletState } from "../../src/wallet/index.js";

// A real viem account — so signatures are genuinely verifiable, not stubbed.
const evm = privateKeyToAccount(`0x${"11".repeat(32)}`);

const keys: SignKeys = { evm };

const STATE = {
  evmAddress: evm.address,
  walletAddress: evm.address,
} as unknown as WalletState;

describe("performSign — the shared-origin money path (browser-side, one gesture)", () => {
  it("signMessage → { signature } recoverable to the wallet's own address", async () => {
    const out = (await performSign({ op: "signMessage", message: "hello" }, keys, STATE)) as {
      signature: `0x${string}`;
    };
    expect(out.signature).toMatch(/^0x[0-9a-f]+$/i);
    const { verifyMessage } = await import("viem");
    expect(await verifyMessage({ address: evm.address, message: "hello", signature: out.signature })).toBe(true);
  });

  it("signSiwe builds the message from the WALLET's address (not a caller-supplied one) and signs it", async () => {
    const params = { domain: "qudi.fi", uri: "https://qudi.fi", version: "1", chainId: 1, nonce: "abc123def" } as const;
    const out = (await performSign({ op: "signSiwe", params }, keys, STATE)) as {
      message: string;
      signature: `0x${string}`;
    };
    const parsed = parseSiweMessage(out.message);
    expect(parsed.address?.toLowerCase()).toBe(evm.address.toLowerCase());
    const { verifyMessage } = await import("viem");
    expect(await verifyMessage({ address: evm.address, message: out.message, signature: out.signature })).toBe(true);
  });

  it("signTransaction returns the RAW hex (not wrapped) — the client returns it directly", async () => {
    const out = await performSign(
      { op: "signTransaction", tx: { to: evm.address, value: 1n, chainId: 10, type: "eip1559" } },
      keys,
      STATE,
    );
    expect(typeof out).toBe("string");
    expect(out as string).toMatch(/^0x[0-9a-f]+$/i);
  });

  it("signAuthorization returns the RAW signed authorization object", async () => {
    const out = (await performSign(
      { op: "signAuthorization", authorization: { chainId: 10, address: evm.address, nonce: 3 } },
      keys,
      STATE,
    )) as { r: string; s: string; yParity: number };
    expect(out.r).toMatch(/^0x/);
    expect(out.s).toMatch(/^0x/);
    expect(typeof out.yParity).toBe("number");
  });

  it("signTypedData → { signature }", async () => {
    const typedData = {
      domain: { name: "Avok", version: "1", chainId: 1 },
      types: { Msg: [{ name: "content", type: "string" }] },
      primaryType: "Msg",
      message: { content: "hi" },
    } as const;
    const out = (await performSign({ op: "signTypedData", typedData }, keys, STATE)) as {
      signature: string;
    };
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
  const state = { evmAddress: evm.address, walletAddress: evm.address } as unknown as WalletState;
  const AUTH = { chainId: 10, address: "0x2222222222222222222222222222222222222222" as const, nonce: 3 };

  it("signSend embeds the signed authorization into the transaction it returns", async () => {
    const raw = (await performSign(
      {
        op: "signSend",
        tx: { chainId: 10, to: evm.address, value: 0n, data: "0x", nonce: 1, gas: 21000n },
        authorization: AUTH,
      },
      keys,
      state,
    )) as `0x${string}`;

    // A type-4 (EIP-7702) transaction — it carries the authorizationList, which only exists because
    // the SAME gesture signed the authorization first.
    expect(raw.startsWith("0x04")).toBe(true);
  });

  it("signSend with NO authorization signs an ordinary transaction (already delegated)", async () => {
    const raw = (await performSign(
      {
        op: "signSend",
        tx: { chainId: 10, to: evm.address, value: 0n, data: "0x", nonce: 1, gas: 21000n, type: "eip1559" },
      },
      keys,
      state,
    )) as `0x${string}`;

    expect(raw.startsWith("0x02")).toBe(true); // type-2, no delegation
  });

  it("signSponsored returns the batch signature AND the signed authorization", async () => {
    const typedData = {
      domain: { name: "AvokWallet", version: "1", chainId: 10, verifyingContract: evm.address },
      types: { T: [{ name: "x", type: "uint256" }] },
      primaryType: "T",
      message: { x: 1n },
    };

    const out = (await performSign({ op: "signSponsored", typedData, authorization: AUTH }, keys, state)) as {
      signature: `0x${string}`;
      authorization?: { address: string; nonce: number };
    };

    expect(out.signature.startsWith("0x")).toBe(true);
    // Both signatures came from one gesture.
    expect(out.authorization?.address).toBe(AUTH.address);
    expect(out.authorization?.nonce).toBe(AUTH.nonce);
  });

  // signUserOp — the 4337 sponsored money path. The origin recomputes the v0.9 userOpHash from the
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
    const out = (await performSign(
      { op: "signUserOp", userOp: USEROP as never, chainId: 10, entryPointVersion: "0.9", authorization: AUTH },
      keys,
      state,
    )) as {
      signature: `0x${string}`;
      authorization?: { address: string; nonce: number };
    };

    const expectedHash = getUserOperationHash({
      chainId: 10,
      entryPointAddress: entryPoint09Address,
      entryPointVersion: "0.9",
      userOperation: USEROP as never,
    });
    // The signature must recover to the wallet key over the hash the ORIGIN computed — proving the
    // signed hash is derived from the fields the consent screen shows, not a caller-supplied digest.
    expect(await recoverAddress({ hash: expectedHash, signature: out.signature })).toBe(evm.address);
    expect(out.authorization?.address).toBe(AUTH.address);
    expect(out.authorization?.nonce).toBe(AUTH.nonce);
  });

  it("signUserOp for a delegated wallet omits the authorization", async () => {
    const out = (await performSign(
      { op: "signUserOp", userOp: USEROP as never, chainId: 10, entryPointVersion: "0.9" },
      keys,
      state,
    )) as {
      signature: `0x${string}`;
      authorization?: unknown;
    };

    expect(out.signature.startsWith("0x")).toBe(true);
    expect(out.authorization).toBeUndefined();
  });

  it("signUserOp for a ROSTER signer wraps the signature with its keyHash — never a raw ecrecover-shaped sig", async () => {
    const rosterState = {
      evmAddress: evm.address,
      walletAddress: "0x2222222222222222222222222222222222222222",
    } as unknown as WalletState;

    const out = (await performSign(
      { op: "signUserOp", userOp: USEROP as never, chainId: 10, entryPointVersion: "0.9" },
      keys,
      rosterState,
    )) as {
      signature: `0x${string}`;
    };

    const { decodeAbiParameters } = await import("viem");
    const { computeSecp256k1KeyHash } = await import("../../src/evm/roster-signature.js");
    const [keyHash, signature] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes" }, { type: "bytes" }],
      out.signature,
    );
    expect(keyHash).toBe(computeSecp256k1KeyHash(evm.address));
    const expectedHash = getUserOperationHash({
      chainId: 10,
      entryPointAddress: entryPoint09Address,
      entryPointVersion: "0.9",
      userOperation: USEROP as never,
    });
    expect(await recoverAddress({ hash: expectedHash, signature })).toBe(evm.address);
  });
});

describe("roster signers (D8): a device whose own key is not the wallet's own address", () => {
  const rosterState = {
    evmAddress: evm.address,
    walletAddress: "0x2222222222222222222222222222222222222222",
  } as unknown as WalletState;
  const AUTH = { chainId: 10, address: "0x3333333333333333333333333333333333333333" as const, nonce: 3 };

  it("signTransaction is unwrapped, ordinary — Calibur authorizes by caller identity on this path", async () => {
    const raw = (await performSign(
      {
        op: "signTransaction",
        tx: { chainId: 10, to: rosterState.walletAddress, value: 0n, data: "0x", nonce: 1, type: "eip1559" as const },
      },
      keys,
      rosterState,
    )) as `0x${string}`;
    expect(raw.startsWith("0x")).toBe(true);
  });

  it("signSend without an authorization is unwrapped, ordinary", async () => {
    const raw = (await performSign(
      {
        op: "signSend",
        tx: { chainId: 10, to: rosterState.walletAddress, value: 0n, data: "0x", nonce: 1, type: "eip1559" as const },
      },
      keys,
      rosterState,
    )) as `0x${string}`;
    expect(raw.startsWith("0x")).toBe(true);
  });

  it("signAuthorization refuses — a roster signer never authorizes the wallet's own EIP-7702 delegation", async () => {
    await expect(performSign({ op: "signAuthorization", authorization: AUTH }, keys, rosterState)).rejects.toThrow(
      /roster signer cannot authorize/i,
    );
  });

  it("signSend WITH an authorization refuses for the same reason", async () => {
    await expect(
      performSign(
        {
          op: "signSend",
          tx: { chainId: 10, to: rosterState.walletAddress, value: 0n, data: "0x", nonce: 1, type: "eip1559" as const },
          authorization: AUTH,
        },
        keys,
        rosterState,
      ),
    ).rejects.toThrow(/roster signer cannot authorize/i);
  });

  it.each(["signMessage", "signTypedData", "signSiwe"] as const)(
    "%s refuses rather than produce a signature Calibur's ERC-1271 (ERC-7739) would reject silently",
    async (op) => {
      const request =
        op === "signMessage"
          ? ({ op, message: "hello" } as const)
          : op === "signTypedData"
            ? ({
                op,
                typedData: {
                  domain: {},
                  types: { X: [{ name: "a", type: "uint256" }] },
                  primaryType: "X",
                  message: { a: 1n },
                },
              } as const)
            : ({
                op,
                params: { domain: "example.com", uri: "https://example.com", version: "1", chainId: 1 },
              } as const);
      await expect(performSign(request as never, keys, rosterState)).rejects.toThrow(/not yet supported for a roster/i);
    },
  );
});
