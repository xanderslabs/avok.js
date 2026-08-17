import { describe, expect, test, vi } from "vitest";
import { getAddress } from "viem";
import { bytesToBase64Url } from "../../src/wallet/encoding.js";
import { decodeUserHandle, encodeAccessHandle } from "../../src/wallet/passkey/label.js";
import { createReactNativePasskeyAdapter, type ReactNativePasskeyLike } from "../../src/wallet/passkey/native.js";

const ADDR = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");
const HANDLE = encodeAccessHandle(ADDR, 10);
const prfB64 = bytesToBase64Url(new Uint8Array(32).fill(5));

describe("createReactNativePasskeyAdapter", () => {
  test("create packs the base64url user handle and reads PRF", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cred-1",
      response: { transports: ["internal"] },
      clientExtensionResults: { prf: { results: { first: prfB64 } } },
    });
    const mod: ReactNativePasskeyLike = { create, get: vi.fn() };
    const pk = createReactNativePasskeyAdapter(mod, { rpId: "qudi.fi", rpName: "Qudi" });
    const reg = await pk.create("Qudi Wallet · 1a2b…9f3c", HANDLE);
    expect(create.mock.calls[0][0].user.id).toBe(bytesToBase64Url(HANDLE));
    expect(reg.credentialId).toBe("cred-1");
    expect(bytesToBase64Url(new Uint8Array(reg.prfOutput))).toBe(prfB64);
  });

  test("create falls back to a get ceremony when PRF is absent at creation", async () => {
    const fallbackPrf = bytesToBase64Url(new Uint8Array(32).fill(4));
    const create = vi.fn().mockResolvedValue({
      id: "cred-1",
      response: { transports: ["internal"] },
      clientExtensionResults: {},
    });
    const get = vi.fn().mockResolvedValue({
      id: "cred-1",
      clientExtensionResults: { prf: { results: { first: fallbackPrf } } },
    });
    const pk = createReactNativePasskeyAdapter({ create, get }, { rpId: "qudi.fi" });
    const reg = await pk.create("x", HANDLE);
    expect(get).toHaveBeenCalledOnce();
    expect(bytesToBase64Url(new Uint8Array(reg.prfOutput))).toBe(fallbackPrf);
  });

  test("discover returns the opaque user handle for decoding", async () => {
    const get = vi.fn().mockResolvedValue({
      id: "cred-1",
      response: { userHandle: bytesToBase64Url(HANDLE) },
      clientExtensionResults: { prf: { results: { first: prfB64 } } },
    });
    const pk = createReactNativePasskeyAdapter({ create: vi.fn(), get }, { rpId: "qudi.fi" });
    const discovered = await pk.discover();
    expect(decodeUserHandle(discovered.userHandle)).toEqual({ kind: "secondary", evm: ADDR, anchorChain: 10 });
  });

  test("rejects a cross-platform (roaming) authenticator on the get paths", async () => {
    const get = vi.fn().mockResolvedValue({
      id: "cred-1",
      authenticatorAttachment: "cross-platform",
      response: { userHandle: bytesToBase64Url(HANDLE) },
      clientExtensionResults: { prf: { results: { first: prfB64 } } },
    });
    const pk = createReactNativePasskeyAdapter({ create: vi.fn(), get }, { rpId: "qudi.fi" });
    await expect(pk.discover()).rejects.toThrow(/platform authenticator/i);
    await expect(pk.authenticate("cred-1")).rejects.toThrow(/platform authenticator/i);
  });
});
