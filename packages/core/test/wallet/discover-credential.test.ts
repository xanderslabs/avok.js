import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebAuthnPasskeyAdapter } from "../../src/wallet/passkey/web.js";

/**
 * THE SESSION SHOULD REMEMBER WHICH PASSKEY IT IS.
 *
 * `discover()` calls navigator.credentials.get() with NO allowCredentials, so the browser shows the
 * account picker — "which wallet?" — EVERY time. That is right for a login: the user is choosing.
 * It is wrong for every popup afterwards.
 *
 * Own-origin does not have this problem. It remembers the credential it logged in with (WalletState
 * carries the slots) and constrains every later assertion to it, so signing goes straight to
 * biometrics. Shared-origin learns the credentialId at authorize — and throws it away.
 *
 * So: discover() gains an optional credentialId. With it, the assertion is constrained and the picker
 * never appears. Without it, nothing changes.
 */

const CREDENTIAL_ID = "Y3JlZGVudGlhbC1pZC0xMjM"; // base64url
const RP_ID = "qudi.fi";

let getArgs: PublicKeyCredentialRequestOptions | undefined;

function fakeAssertion() {
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: { userHandle: new Uint8Array([9, 9]).buffer },
    getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }),
    authenticatorAttachment: "platform",
  };
}

beforeEach(() => {
  getArgs = undefined;
  vi.stubGlobal("navigator", {
    credentials: {
      get: vi.fn(async (opts: CredentialRequestOptions) => {
        getArgs = opts.publicKey;
        return fakeAssertion() as unknown as Credential;
      }),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("discover()", () => {
  it("with NO credentialId, sends no allowCredentials — the picker, i.e. 'which wallet?'", async () => {
    const adapter = new WebAuthnPasskeyAdapter({ rpName: "Qudi", rpId: RP_ID });

    await adapter.discover();

    // This is correct for a LOGIN: the user must be able to choose, including a wallet this device
    // has never seen. Constraining here would make it impossible to pick a different wallet.
    expect(getArgs?.allowCredentials).toBeUndefined();
  });

  it("with a credentialId, CONSTRAINS the assertion to it — straight to biometrics, no picker", async () => {
    const adapter = new WebAuthnPasskeyAdapter({ rpName: "Qudi", rpId: RP_ID });

    await adapter.discover({ credentialId: CREDENTIAL_ID });

    const allowed = getArgs?.allowCredentials;
    expect(allowed).toHaveLength(1);
    expect(allowed?.[0]?.type).toBe("public-key");
    // The id is the decoded credential — the browser matches it and prompts for that one only.
    expect(allowed?.[0]?.id).toBeInstanceOf(ArrayBuffer);
  });

  it("still asks for PRF and user verification when constrained", async () => {
    const adapter = new WebAuthnPasskeyAdapter({ rpName: "Qudi", rpId: RP_ID });

    await adapter.discover({ credentialId: CREDENTIAL_ID });

    // The PRF output IS the wallet key. Losing the extension here would derive nothing.
    expect(getArgs?.extensions?.prf).toBeDefined();
    expect(getArgs?.userVerification).toBe("required");
    expect(getArgs?.rpId).toBe(RP_ID);
  });

  it("returns the credentialId of the credential actually used", async () => {
    const adapter = new WebAuthnPasskeyAdapter({ rpName: "Qudi", rpId: RP_ID });

    const discovered = await adapter.discover();

    // authorize must be able to RECORD this without a second prompt — it is the one thing the
    // shared-origin flow needs from the gesture it is already performing.
    expect(discovered.credentialId).toBeTypeOf("string");
    expect(discovered.credentialId.length).toBeGreaterThan(0);
  });
});
