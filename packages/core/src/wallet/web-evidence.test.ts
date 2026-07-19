// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebAuthnPasskeyAdapter } from "./passkey/web.js";

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

afterEach(() => vi.unstubAllGlobals());

describe("WebAuthnPasskeyAdapter.authenticateWithEvidence", () => {
  it("returns PRF + assertion from a single credentials.get and never leaks PRF in evidence", async () => {
    const prf = enc("prf-out");
    const cred = {
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({ prf: { results: { first: prf } } }),
      response: {
        clientDataJSON: enc("cdj"),
        authenticatorData: enc("ad"),
        signature: enc("sig"),
        userHandle: enc("uh"),
      },
    };
    const get = vi.fn().mockResolvedValue(cred);
    vi.stubGlobal("navigator", { credentials: { get } });

    // Real constructor: options object, not a bare string.
    const adapter = new WebAuthnPasskeyAdapter({ rpId: "qudi.fi" });
    const { prfOutput, assertion } = await adapter.authenticateWithEvidence!(
      "cred-1",
      ["internal"],
      "chal-xyz",
    );

    // PRF key material is returned for local decryption
    expect(new Uint8Array(prfOutput)).toEqual(new Uint8Array(prf));
    // clientExtensionResults is emptied — PRF never leaks into the evidence
    expect(assertion.response.clientExtensionResults).toEqual({});
    // Credential id is echoed into the evidence
    expect(assertion.response.id).toBe("cred-1");
    // The server challenge was base64url-decoded and passed into the WebAuthn ceremony
    const passed = get.mock.calls[0][0].publicKey;
    expect(new Uint8Array(passed.challenge as ArrayBuffer)).toEqual(
      new Uint8Array(Buffer.from("chal-xyz", "base64url")),
    );
  });
});
