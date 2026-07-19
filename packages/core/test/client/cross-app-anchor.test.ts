import { describe, it, expect } from "vitest";
import { decodeFunctionData, hexToBytes, verifyMessage, type Address, type Hex } from "viem";
import { createOwnOriginConnection } from "../../src/own-origin/connection.js";
import { makeFakePasskey, ACCESS_SLOT_WRITER } from "./fakes.js";
import { ACCESS_VAULT_ABI, type VaultReader } from "../../src/wallet/index.js";
import type { Call } from "../../src/evm/index.js";

/**
 * Cross-app passkey interuse (the whole point of Related Origin Requests): two apps share an rpId
 * but configure DIFFERENT anchor chains. A secondary enrolled by app A writes its access-slot blob to A's
 * anchor. App B — same authenticator, different configured anchor — must still recover that secondary.
 *
 * The bug: reads used the READING app's configured anchor. App B (mainnet) queried mainnet for a blob
 * that lives on optimism → not found → SlotUnreachableError, even though the credential is valid and
 * its blob is right there on optimism.
 *
 * The fix: the secondary's handle records the anchor chain it was enrolled against, so reads follow
 * that marker regardless of the reading app's own anchor config.
 */
function chainVault() {
  const store = new Map<string, Uint8Array>();
  return {
    // addPasskey's on-chain write for THIS chain: absorb the addAccessSlot self-call.
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
    ...ACCESS_SLOT_WRITER,
    ...ACCESS_SLOT_WRITER,
    getAccessSlot: async (_address: Address, slotId: Hex) => store.get(slotId.toLowerCase()) ?? null,
  };
}

const EMPTY_VAULT: VaultReader = { getAccessSlot: async () => null };

describe("cross-app secondary recovery (shared rpId, different app anchors)", () => {
  it("recovers a secondary enrolled on chain A (optimism) from app B configured for chain B (mainnet)", async () => {
    // ── App A: anchor = optimism (eip155:10). Enrol a secondary; its blob lands on A's vault. ──
    const passkey = makeFakePasskey("localhost");
    const appA = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    const acc = await appA.create();

    const vaultA = chainVault(); // stands in for optimism's access vault
    const { passkeyCount } = await appA.addPasskey({
      submit: vaultA.submit,
      hasSlot: vaultA.hasSlot,
      assertCanAffordAccessSlot: async () => {},
      ...ACCESS_SLOT_WRITER,
      ...ACCESS_SLOT_WRITER,
    });
    expect(passkeyCount).toBe(2);

    // ── App B: FRESH connection, anchor = mainnet (eip155:1). Same authenticator (ROR), presenting
    //    the SECONDARY credential. B's vaultForChain has the blob ONLY on chain 10 (A); chain 1 (B's
    //    own anchor) is empty. If resolution used B's configured anchor, it would query the empty
    //    chain-1 vault and fail. It must instead read chain 10 from the credential's handle marker. ──
    passkey.setDiscoveredCredential(passkey.allCredentialIds()[1]);
    const appB = createOwnOriginConnection({
      rpId: "localhost",
      passkey,
      anchorChainId: "eip155:1", // DIFFERENT app anchor than the one that enrolled the secondary
      vaultForChain: (chainId) => (chainId === 10 ? vaultA : EMPTY_VAULT),
    });

    const recovered = await appB.continue();

    // Recovered the SAME wallet — because B read chain 10 (the marker), not its configured chain 1.
    expect(recovered.evm.address.toLowerCase()).toBe(acc.evm.address.toLowerCase());
    expect(recovered.solana.address).toBe(acc.solana.address);
    // And the recovered secondary decrypts the SAME K, so it signs to the same address.
    const sig = await appB.signMessage({ message: "cross-app recovered" });
    expect(await verifyMessage({ address: acc.evm.address, message: "cross-app recovered", signature: sig })).toBe(
      true,
    );
  });
});
