import { expect } from "vitest";
import { decodeFunctionData, hexToBytes, type Address, type Hex } from "viem";
import { createOwnOriginConnection } from "../../src/own-origin/connection.js";
import { makeFakePasskey, type FakePasskey, ACCESS_SLOT_WRITER } from "./fakes.js";
import { ACCESS_VAULT_ABI, decryptKeyBlob, deserializeBlob } from "../../src/wallet/index.js";
import type { Call } from "../../src/evm/index.js";

/** The chain: absorbs addAccessSlot and serves the blob + metadata back. Doubles as the AccessCtx and
 *  as the injected roster reader (it implements getAccessSlotIds, so rosterForChain picks it up). */
export function capturingVault() {
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
    ...ACCESS_SLOT_WRITER, ...ACCESS_SLOT_WRITER,
    getAccessSlot: async (_a: Address, slotId: Hex) => blobs.get(slotId.toLowerCase()) ?? null,
    getAccessSlotIds: async (_a: Address) => [...blobs.keys()] as Hex[],
    getAccessSlotAddedAt: async () => 1_700_000_000,
    getAccessSlotMeta: async (_a: Address, slotId: Hex) => metas.get(slotId.toLowerCase()) ?? new Uint8Array(0),
  };
}

export type Conn = ReturnType<typeof createOwnOriginConnection>;
export type Vault = ReturnType<typeof capturingVault>;

/** A holder (the live wallet) and an enroller. The enroller is an INDEPENDENT domain here — but the
 *  ceremony and the passkey are identical when the new credential is simply the user's own second device. */
export function twoSides(vault: Vault) {
  const passkeyEnroller = makeFakePasskey("independent.example");
  return {
    passkeyEnroller,
    holder: createOwnOriginConnection({ rpId: "qudi.fi", passkey: makeFakePasskey("qudi.fi"), anchorVault: vault }),
    enroller: createOwnOriginConnection({
      rpId: "independent.example",
      passkey: passkeyEnroller,
      anchorVault: vault,
    }),
  };
}

/** The whole ceremony: THREE codes, capturing every payload that crosses the wire. */
export async function enrolAccessSlot(holder: Conn, enroller: Conn, vault: Vault) {
  const wire: string[] = [];

  const { qr: request } = await enroller.pairing.enroller.begin();
  wire.push(request);

  // The ack carries the sealed offer (wallet + anchor chain). Folding it in is what keeps the ceremony
  // at three codes even though the wallet key no longer travels.
  const { qr: ack, sas: sasHolder } = await holder.pairing.holder.authorize({ qr: request, ctx: vault });
  wire.push(ack);
  const { sas: sasEnroller } = await enroller.pairing.enroller.receiveAck(ack);
  expect(sasHolder).toBe(sasEnroller); // the human compares these on the two screens

  const { qr: wrap, rpId } = await enroller.pairing.enroller.enroll({ sasConfirmed: true });
  wire.push(wrap);

  const { slotId, txId } = await holder.pairing.holder.complete({ qr: wrap, sasConfirmed: true, ctx: vault });
  return { wire, rpId, slotId, txId };
}

/** What the enrolled credential can do afterwards, holding ONLY its own passkey. */
export async function openAccessSlot(passkey: FakePasskey, vault: Vault, address: Address, slotId: Hex): Promise<Uint8Array> {
  const stored = await vault.getAccessSlot(address, slotId);
  const credentialId = passkey.allCredentialIds()[0];
  const prf = await passkey.authenticate(credentialId);
  const container = await decryptKeyBlob(deserializeBlob(stored!), prf, address, credentialId);
  return Uint8Array.from(container.key); // a copy — reconstructFromKey wipes what it is handed
}

