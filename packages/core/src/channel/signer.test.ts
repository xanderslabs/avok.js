import { describe, expect, it, vi } from "vitest";
import { createRemoteSigner } from "./signer.js";
import type { SigningChannel } from "./channels/port.js";
import type { SignedAuthorizationLike } from "./types.js";

describe("remote signer", () => {
  it("routes signMessage over the channel and returns the signature", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: { signature: "0xsig" } });
    const channel: SigningChannel = { open };
    const signer = createRemoteSigner({ channel, credentialId: "cred1" });
    const sig = await signer.signMessage({ message: "hello" });
    expect(sig).toBe("0xsig");
    expect(open).toHaveBeenCalledWith({ kind: "sign", credentialId: "cred1", request: { op: "signMessage", message: "hello" } });
  });

  it("routes signTypedData and returns the signature", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: { signature: "0xtd" } });
    const channel: SigningChannel = { open };
    const signer = createRemoteSigner({ channel, credentialId: "cred2" });
    const typedDataDef = { domain: { name: "test" }, types: {}, primaryType: "Test", message: {} };
    const sig = await signer.signTypedData(typedDataDef);
    expect(sig).toBe("0xtd");
    expect(open).toHaveBeenCalledWith({
      kind: "sign",
      credentialId: "cred2",
      request: { op: "signTypedData", typedData: typedDataDef },
    });
  });

  it("routes signSiwe and returns message + signature", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: { message: "m", signature: "0xs" } });
    const channel: SigningChannel = { open };
    const signer = createRemoteSigner({ channel, credentialId: "cred3" });
    const siweParams = { domain: "d", uri: "u", version: "1", chainId: 10, nonce: "n" } as never;
    const result = await signer.signSiwe(siweParams);
    expect(result).toEqual({ message: "m", signature: "0xs" });
    expect(open).toHaveBeenCalledWith({
      kind: "sign",
      credentialId: "cred3",
      request: { op: "signSiwe", params: siweParams },
    });
  });

  it("routes signAuthorization and returns the signed authorization", async () => {
    const signedAuth: SignedAuthorizationLike = {
      address: "0x1234567890123456789012345678901234567890",
      chainId: 1,
      nonce: 42,
      r: "0xaaaa",
      s: "0xbbbb",
      yParity: 0,
    };
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: signedAuth });
    const channel: SigningChannel = { open };
    const signer = createRemoteSigner({ channel, credentialId: "cred4" });
    const authorization = { chainId: 1, address: "0x1234567890123456789012345678901234567890" as const, nonce: 42 };
    const result = await signer.signAuthorization(authorization);
    expect(result).toEqual(signedAuth);
    expect(open).toHaveBeenCalledWith({
      kind: "sign",
      credentialId: "cred4",
      request: { op: "signAuthorization", authorization },
    });
  });

  it("routes signTransaction and returns the serialized hex", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: "0xdeadbeef" });
    const channel: SigningChannel = { open };
    const signer = createRemoteSigner({ channel, credentialId: "cred5" });
    const tx = { to: "0x1234567890123456789012345678901234567890", value: 100n } as never;
    const result = await signer.signTransaction(tx);
    expect(result).toBe("0xdeadbeef");
    expect(open).toHaveBeenCalledWith({
      kind: "sign",
      credentialId: "cred5",
      request: { op: "signTransaction", tx },
    });
  });
});

/**
 * ONE POPUP, ONE GESTURE — the composite ops.
 *
 * `channel.open` IS the popup: every call is a window the user sees and a biometric prompt they
 * answer. Counting it is the only honest test, because the bug was never visible in the result — the
 * transaction was signed correctly, the user was just interrupted twice.
 *
 * An undelegated wallet's send needs TWO signatures, and the transaction EMBEDS the signed
 * authorization — so they cannot be independent requests, and they cannot be a generic batch either
 * (request 2 needs request 1's output). Hence a composite op: ONE round-trip, and the origin signs
 * both under the single `withDiscoveredKeys` gesture it already performs.
 */
describe("composite ops — one round-trip, one popup", () => {
  const AUTH = { chainId: 10, address: "0x1111111111111111111111111111111111111111" as const, nonce: 7 };

  it("signSend sends ONE request carrying both the tx and the authorization", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: "0xserialized" });
    const signer = createRemoteSigner({ channel: { open } as SigningChannel, credentialId: "s" });

    const raw = await signer.signSend({ tx: { chainId: 10 }, authorization: AUTH });

    expect(raw).toBe("0xserialized");
    expect(open).toHaveBeenCalledTimes(1); // ← ONE popup, not two
    expect(open).toHaveBeenCalledWith({
      kind: "sign",
      credentialId: "s",
      request: { op: "signSend", tx: { chainId: 10 }, authorization: AUTH },
    });
  });

  it("signSponsored sends ONE request and returns both the signature and the signed authorization", async () => {
    const signedAuth = { ...AUTH, r: "0xr", s: "0xs", yParity: 0 } as unknown as SignedAuthorizationLike;
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: { signature: "0xsig", authorization: signedAuth } });
    const signer = createRemoteSigner({ channel: { open } as SigningChannel, credentialId: "s" });

    const td = { domain: { name: "t" }, types: {}, primaryType: "T", message: {} };
    const out = await signer.signSponsored({ typedData: td, authorization: AUTH });

    expect(out.signature).toBe("0xsig");
    expect(out.authorization).toEqual(signedAuth);
    expect(open).toHaveBeenCalledTimes(1); // ← ONE popup
  });

  it("a DELEGATED wallet needs no authorization — still one request", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: "0xraw" });
    const signer = createRemoteSigner({ channel: { open } as SigningChannel, credentialId: "s" });

    await signer.signSend({ tx: { chainId: 10 } });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].request).toEqual({ op: "signSend", tx: { chainId: 10 }, authorization: undefined });
  });

  // signUserOp is the 4337 sponsored analogue of signSponsored: instead of a SponsoredBatch typed-data it
  // carries the (unsigned) v0.8 UserOperation + chainId, so the ORIGIN recomputes the userOpHash from
  // the same fields it shows the user (sign-what-you-saw) and signs it, plus the 7702 authorization
  // when undelegated — all under the single gesture.
  const USEROP = {
    sender: "0x2222222222222222222222222222222222222222" as const,
    nonce: 0n,
    callData: "0xdeadbeef" as const,
    callGasLimit: 1n,
    verificationGasLimit: 1n,
    preVerificationGas: 1n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    signature: "0x" as const,
  };

  it("signUserOp sends ONE request carrying the userOp, chainId and authorization; returns both", async () => {
    const signedAuth = { ...AUTH, r: "0xr", s: "0xs", yParity: 0 } as unknown as SignedAuthorizationLike;
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: { signature: "0xsig", authorization: signedAuth } });
    const signer = createRemoteSigner({ channel: { open } as SigningChannel, credentialId: "s" });

    const out = await signer.signUserOp({ userOp: USEROP as never, chainId: 10, authorization: AUTH });

    expect(out.signature).toBe("0xsig");
    expect(out.authorization).toEqual(signedAuth);
    expect(open).toHaveBeenCalledTimes(1); // ← ONE popup
    expect(open).toHaveBeenCalledWith({
      kind: "sign",
      credentialId: "s",
      request: { op: "signUserOp", userOp: USEROP, chainId: 10, authorization: AUTH },
    });
  });

  it("signUserOp for a DELEGATED wallet omits the authorization — still one request", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "sign", result: { signature: "0xsig" } });
    const signer = createRemoteSigner({ channel: { open } as SigningChannel, credentialId: "s" });

    const out = await signer.signUserOp({ userOp: USEROP as never, chainId: 10 });

    expect(out.signature).toBe("0xsig");
    expect(out.authorization).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].request).toEqual({ op: "signUserOp", userOp: USEROP, chainId: 10, authorization: undefined });
  });
});
