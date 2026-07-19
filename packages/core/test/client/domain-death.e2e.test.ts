import { describe, expect, it } from "vitest";
import { decodeFunctionData, hexToBytes, verifyMessage, type Address, type Hex } from "viem";
import { createOwnOriginConnection } from "../../src/own-origin/connection.js";
import { makeFakePasskey, ACCESS_SLOT_WRITER } from "./fakes.js";
import { ACCESS_VAULT_ABI } from "../../src/wallet/index.js";
import type { Call } from "../../src/evm/index.js";

/**
 * THE SCENARIO THIS ALL EXISTS FOR: the primary domain dies, and the wallet survives.
 *
 * A wallet is born on qudi.fi (a primary passkey — K = HKDF(prf₁), nothing on chain). An INDEPENDENT
 * domain enrols a passkey without ever receiving K. Then qudi.fi is thrown away entirely — no
 * app, no session, no passkey — and the wallet is recovered, and SIGNS, from that domain alone.
 *
 * Every passkey wallet shipping today is hostage to one domain. This test is the counter-example.
 */
function chain() {
  const blobs = new Map<string, Uint8Array>();
  const metas = new Map<string, Uint8Array>();
  return {
    submit: async (calls: Call[], _o: { chainId: number }) => {
      for (const c of calls) {
        const decoded = decodeFunctionData({ abi: ACCESS_VAULT_ABI, data: c.data });
        if (decoded.functionName === "addAccessSlot") {
          const [slotId, blob, meta] = decoded.args as [Hex, Hex, Hex];
          blobs.set(slotId.toLowerCase(), hexToBytes(blob));
          metas.set(slotId.toLowerCase(), hexToBytes(meta));
        }
      }
      return { id: "tx-enrol" };
    },
    hasSlot: async (slotId: Hex) => blobs.has(slotId.toLowerCase()),
    assertCanAffordAccessSlot: async () => {},
    ...ACCESS_SLOT_WRITER,
    ...ACCESS_SLOT_WRITER,
    getAccessSlot: async (_a: Address, slotId: Hex) => blobs.get(slotId.toLowerCase()) ?? null,
    getAccessSlotIds: async (_a: Address) => [...blobs.keys()] as Hex[],
    getAccessSlotAddedAt: async () => 1_700_000_000,
    getAccessSlotMeta: async (_a: Address, slotId: Hex) => metas.get(slotId.toLowerCase()) ?? new Uint8Array(0),
  };
}

describe("the primary domain dies and the wallet survives", () => {
  it("recovers and signs through the independent domain alone, with the primary app gone", async () => {
    const vault = chain();

    // ── 1. A wallet is born on the primary domain. Nothing is written on chain. ──
    const primaryPasskey = makeFakePasskey("qudi.fi");
    const primary = createOwnOriginConnection({ rpId: "qudi.fi", passkey: primaryPasskey, anchorVault: vault });
    const account = await primary.create();

    // ── 2. An INDEPENDENT domain enrols a passkey. It has no wallet and no chain access. ──
    const enrollerPasskey = makeFakePasskey("independent.example");
    const enroller = createOwnOriginConnection({
      rpId: "independent.example",
      passkey: enrollerPasskey,
      anchorVault: vault,
    });

    const { qr: request } = await enroller.pairing.enroller.begin();
    const { qr: ack, sas } = await primary.pairing.holder.authorize({ qr: request, ctx: vault });
    expect((await enroller.pairing.enroller.receiveAck(ack)).sas).toBe(sas);
    const { qr: wrap } = await enroller.pairing.enroller.enroll({ sasConfirmed: true });
    await primary.pairing.holder.complete({ qr: wrap, sasConfirmed: true, ctx: vault });

    // The enroller still has no wallet: it ran a ceremony, it did not receive a key.
    expect(enroller.status()).toBe(false);

    // ── 3. qudi.fi DIES. The app, its session, and its passkey are gone forever. ──
    // (Nothing below may touch `primary` or `primaryPasskey`. The only surviving artifacts are the
    //  enrolled credential and the public slot on chain.)

    // ── 4. A cold session on the independent domain: only its passkey and the chain. ──
    const survivor = createOwnOriginConnection({
      rpId: "independent.example",
      passkey: enrollerPasskey,
      anchorVault: vault,
    });
    const recovered = await survivor.continue();

    expect(recovered.evm.address).toBe(account.evm.address);
    expect(recovered.solana.address).toBe(account.solana.address); // the Solana key survives too

    // ── 5. And it is a REAL passkey, not a listing: it signs as the wallet. ──
    const signature = await survivor.signMessage({ message: "the wallet outlived its domain" });
    expect(
      await verifyMessage({
        address: account.evm.address,
        message: "the wallet outlived its domain",
        signature,
      }),
    ).toBe(true);
  });
});
