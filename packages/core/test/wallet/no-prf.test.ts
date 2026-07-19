// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { WebAuthnPasskeyAdapter } from "../../src/wallet/passkey/web.js";
import { createReactNativePasskeyAdapter } from "../../src/wallet/passkey/native.js";
import { NoPrfError } from "../../src/wallet/passkey/adapter.js";

// The one physical cause — an authenticator that evaluates no PRF at create AND at the get()
// fallback (measured: Chrome's own profile authenticator, adce0002…) — must surface as the SAME
// named error, so "no PRF, no wallet" is enforced structurally rather than as an anonymous Error
// with a developer string. We assert `instanceof NoPrfError`, not a message regex: a plain Error
// carrying the same text would pass a regex and let this defect back in.

const HANDLE = new Uint8Array(33).fill(1);

describe("no PRF, no wallet", () => {
  test("web create() throws NoPrfError when PRF is absent at create AND get", async () => {
    const noPrfCredential = {
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: { getTransports: () => ["internal"], userHandle: HANDLE.buffer },
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}), // no prf, either ceremony
    };
    const create = vi.fn().mockResolvedValue(noPrfCredential);
    const get = vi.fn().mockResolvedValue(noPrfCredential);
    vi.stubGlobal("navigator", { credentials: { create, get } });

    const pk = new WebAuthnPasskeyAdapter({ rpId: "qudi.fi" });
    await expect(pk.create("x", HANDLE)).rejects.toBeInstanceOf(NoPrfError);
  });

  test("native create() throws NoPrfError when PRF is absent at create AND get", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cred-1", response: { transports: ["internal"] }, clientExtensionResults: {},
    });
    const get = vi.fn().mockResolvedValue({ id: "cred-1", clientExtensionResults: {} });
    const pk = createReactNativePasskeyAdapter({ create, get }, { rpId: "qudi.fi" });
    await expect(pk.create("x", HANDLE)).rejects.toBeInstanceOf(NoPrfError);
  });
});
