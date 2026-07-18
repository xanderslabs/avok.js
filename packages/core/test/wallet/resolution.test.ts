import { describe, expect, test } from "vitest";
import { hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptKeyBlob, serializeBlob } from "../../src/wallet/crypto/blob.js";
import { deriveSlotId } from "../../src/wallet/passkey/label.js";
import { resolveBlob } from "../../src/wallet/resolution.js";
import { FakeVaultReader } from "./fakes.js";

async function makeBlob() {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  const container = { key: hexToBytes(key) };
  const credentialId = "Y3JlZC1hYWE";
  const blob = await encryptKeyBlob({
    container, address, credentialId,
    prfOutput: new Uint8Array(32).buffer,
  });
  return { address, credentialId, blob };
}

describe("secondary blob resolution (anchor → tx-chain)", () => {
  test("anchor wins", async () => {
    const { address, credentialId, blob } = await makeBlob();
    const anchor = new FakeVaultReader();
    anchor.set(address, deriveSlotId(address, credentialId), serializeBlob(blob));
    const res = await resolveBlob({ address, credentialId, anchorVault: anchor });
    expect(res?.source).toBe("anchor");
  });

  test("falls through anchor → tx-chain", async () => {
    const { address, credentialId, blob } = await makeBlob();
    const txVault = new FakeVaultReader();
    txVault.set(address, deriveSlotId(address, credentialId), serializeBlob(blob));
    const res = await resolveBlob({ address, credentialId, anchorVault: new FakeVaultReader(), txChainVault: txVault });
    expect(res?.source).toBe("tx-chain");
  });

  test("returns null when nothing has the blob", async () => {
    const { address, credentialId } = await makeBlob();
    const res = await resolveBlob({ address, credentialId, anchorVault: new FakeVaultReader() });
    expect(res).toBeNull();
  });

  test("returns null when the tx-chain vault is also empty", async () => {
    const { address, credentialId } = await makeBlob();
    const res = await resolveBlob({ address, credentialId, anchorVault: new FakeVaultReader(), txChainVault: new FakeVaultReader() });
    expect(res).toBeNull();
  });
});
