// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { getAddress } from "viem";
import { WebAuthnPasskeyAdapter, getPrfSalt } from "../../src/wallet/passkey/web.js";
import { bytesToBase64Url } from "../../src/wallet/encoding.js";
import { decodeUserHandle, encodeAccessHandle } from "../../src/wallet/passkey/label.js";

const ADDR = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");
const HANDLE = encodeAccessHandle(ADDR, 10);

function fakeCredential(prf: Uint8Array) {
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: { getTransports: () => ["internal"], userHandle: HANDLE.buffer },
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({ prf: { results: { first: prf.buffer } } }),
  };
}

describe("WebAuthnPasskeyAdapter", () => {
  test("create requests a platform passkey with PRF and packs the opaque handle", async () => {
    const prf = new Uint8Array(32).fill(7);
    const create = vi.fn().mockResolvedValue(fakeCredential(prf));
    vi.stubGlobal("navigator", { credentials: { create, get: vi.fn() } });
    const pk = new WebAuthnPasskeyAdapter({ rpId: "qudi.fi", rpName: "Qudi" });
    const reg = await pk.create("Qudi Wallet · 1a2b…9f3c", HANDLE);

    const opts = create.mock.calls[0][0].publicKey;
    expect(opts.rp.id).toBe("qudi.fi");
    expect(new Uint8Array(opts.user.id)).toEqual(HANDLE);
    expect(opts.extensions.prf.eval.first).toEqual(getPrfSalt());
    expect(reg.credentialId).toBe(bytesToBase64Url(new Uint8Array([1, 2, 3])));
    expect(new Uint8Array(reg.prfOutput)).toEqual(prf);
  });

  test("create falls back to an authenticate ceremony when PRF is absent at creation", async () => {
    const fallbackPrf = new Uint8Array(32).fill(3);
    const noPrf = {
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: { getTransports: () => ["internal"], userHandle: HANDLE.buffer },
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
    };
    const create = vi.fn().mockResolvedValue(noPrf);
    const get = vi.fn().mockResolvedValue(fakeCredential(fallbackPrf));
    vi.stubGlobal("navigator", { credentials: { create, get } });
    const pk = new WebAuthnPasskeyAdapter({ rpId: "qudi.fi" });
    const reg = await pk.create("x", HANDLE);
    expect(get).toHaveBeenCalledOnce();
    expect(new Uint8Array(reg.prfOutput)).toEqual(fallbackPrf);
  });

  test("discover returns the opaque user handle for decoding", async () => {
    const get = vi.fn().mockResolvedValue(fakeCredential(new Uint8Array(32).fill(9)));
    vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get } });
    const pk = new WebAuthnPasskeyAdapter({ rpId: "qudi.fi" });
    const discovered = await pk.discover();
    expect(decodeUserHandle(discovered.userHandle)).toEqual({ kind: "secondary", evm: ADDR, anchorChain: 10 });
  });
});
