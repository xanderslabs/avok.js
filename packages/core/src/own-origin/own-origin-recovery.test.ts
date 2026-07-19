import { describe, it, expect } from "vitest";
import { decodeFunctionData, hexToBytes, verifyMessage, type Address, type Hex } from "viem";
import { createOwnOriginConnection } from "./connection.js";
import { makeFakePasskey, ACCESS_SLOT_WRITER } from "../client/fakes.js";
import { ACCESS_VAULT_ABI } from "../wallet/index.js";
import type { Call } from "../evm/index.js";

/**
 * A fake anchor vault that ALSO absorbs addPasskey's on-chain write. `submit()` decodes the
 * addAccessSlot(slotId, encryptedBlob) self-call and stores the ciphertext exactly as the chain
 * would, so a fresh device can read it back through `getAccessSlot()`. This proves the real
 * enrol → write → recover round-trip for a SECONDARY credential (the only path that touches chain;
 * a primary never does).
 */
function capturingVault() {
  const store = new Map<string, Uint8Array>();
  return {
    submit: async (calls: Call[], _o: { chainId: number }) => {
      for (const c of calls) {
        const decoded = decodeFunctionData({ abi: ACCESS_VAULT_ABI, data: c.data });
        if (decoded.functionName === "addAccessSlot") {
          const [slotId, encryptedBlob] = decoded.args as [Hex, Hex, Hex];
          store.set(slotId.toLowerCase(), hexToBytes(encryptedBlob));
        }
      }
      return { id: "tx-add" };
    },
    hasSlot: async (slotId: Hex) => store.has(slotId.toLowerCase()),
    assertCanAffordAccessSlot: async () => {},
    ...ACCESS_SLOT_WRITER, ...ACCESS_SLOT_WRITER,
    getAccessSlot: async (_address: Address, slotId: Hex) => store.get(slotId.toLowerCase()) ?? null,
  };
}

describe("own-origin connection recovery from the on-chain slot (secondary path)", () => {
  it("continue() on a fresh device recovers a SECONDARY from the anchor vault and signs to the same wallet", async () => {
    const passkey = makeFakePasskey("localhost");
    const conn1 = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    const acc = await conn1.create();

    // Enrol a secondary; the write lands in the fake anchor vault.
    const vault = capturingVault();
    const { passkeyCount } = await conn1.addPasskey({ submit: vault.submit, hasSlot: vault.hasSlot, assertCanAffordAccessSlot: async () => {},
    ...ACCESS_SLOT_WRITER, ...ACCESS_SLOT_WRITER });
    expect(passkeyCount).toBe(2);

    // Fresh device: the synced passkey can still discover(), but present the SECONDARY credential
    // (slot 2). Its blob is not local — recovery must come from the on-chain anchor vault.
    passkey.setDiscoveredCredential(passkey.allCredentialIds()[1]);
    const conn2 = createOwnOriginConnection({ rpId: "localhost", passkey, anchorVault: vault });
    const recovered = await conn2.continue();

    expect(recovered.evm.address.toLowerCase()).toBe(acc.evm.address.toLowerCase());
    // The recovered secondary decrypts the SAME K, so it signs to the same address.
    const sig = await conn2.signMessage({ message: "recovered secondary" });
    expect(await verifyMessage({ address: acc.evm.address, message: "recovered secondary", signature: sig })).toBe(true);
  });
});
