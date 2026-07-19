import { describe, expect, it } from "vitest";
import { hexToBytes, recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { withWalletKeyAndEvidence } from "./sandbox.js";
import { encryptKeyBlob } from "./crypto/blob.js";
import { produceSolanaKey } from "./crypto/container.js";
import { solanaAddressFromSecret } from "./crypto/derive.js";
import type { PasskeyAdapter } from "./passkey/adapter.js";
import type { AvokAssertionEvidence } from "./webauthn-evidence.js";

const PRF = new TextEncoder().encode("prf-secret-32-bytes-padding-xxxx").buffer;

function assertion(id: string): AvokAssertionEvidence {
  return { response: { id, rawId: id, type: "public-key", response: { clientDataJSON: "c", authenticatorData: "a", signature: "s" }, clientExtensionResults: {} } };
}

async function setup() {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  const container = { key: hexToBytes(key) };
  const solanaAddress = solanaAddressFromSecret(produceSolanaKey(container));
  const blob = await encryptKeyBlob({
    container,
    address,
    credentialId: "cred-1",
    prfOutput: PRF,
  });
  const passkey: PasskeyAdapter = {
    create: async () => { throw new Error("unused"); },
    authenticate: async () => PRF,
    discover: async () => { throw new Error("unused"); },
    authenticateWithEvidence: async (credentialId) => ({ prfOutput: PRF, assertion: assertion(credentialId) }),
  };
  const state = { evmAddress: address, solanaAddress, slots: [{ credentialId: "cred-1", rpId: "qudi.fi", createdAt: "now" }], blobs: [{ credentialId: "cred-1", blob }] };
  return { state, passkey, address };
}

describe("withWalletKeyAndEvidence", () => {
  it("signs with the in-sandbox key AND returns the captured assertion in one ceremony", async () => {
    const { state, passkey, address } = await setup();
    const { result, assertion } = await withWalletKeyAndEvidence(
      { state, passkey, credentialId: "cred-1", challenge: "chal-123" },
      (account) => account.signMessage({ message: "hello" }),
    );
    expect(result).toMatch(/^0x[0-9a-f]+$/i);
    expect(assertion.response.id).toBe("cred-1");
    const recovered = await recoverMessageAddress({ message: "hello", signature: result as `0x${string}` });
    expect(recovered.toLowerCase()).toBe(address.toLowerCase());
  });

  it("throws if the adapter lacks authenticateWithEvidence", async () => {
    const { state } = await setup();
    const bare: PasskeyAdapter = { create: async () => { throw new Error(); }, authenticate: async () => PRF, discover: async () => { throw new Error(); } };
    await expect(
      withWalletKeyAndEvidence({ state, passkey: bare, credentialId: "cred-1", challenge: "c" }, async () => "x"),
    ).rejects.toThrow(/evidence/i);
  });
});
