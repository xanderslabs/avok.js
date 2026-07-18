import { describe, expect, test } from "vitest";
import { hexToBytes, type Address, type Hex } from "viem";
import { listAccessSlots } from "../../src/wallet/roster.js";
import { readAccessSlotRpId } from "../../src/wallet/roster-meta.js";
import { encryptSlotMeta, META_BYTES } from "../../src/wallet/crypto/slot-meta.js";
import { deriveSlotId } from "../../src/wallet/passkey/label.js";

const ADDR = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as Address;
const K = hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318");

function readerWith(entries: { slotId: Hex; addedAt: number; encryptedMeta?: Uint8Array }[]) {
  return {
    getAccessSlotIds: async (_a: Address) => entries.map((e) => e.slotId),
    getAccessSlotAddedAt: async (_a: Address, slotId: Hex) =>
      entries.find((e) => e.slotId === slotId)?.addedAt ?? 0,
    getAccessSlotMeta: async (_a: Address, slotId: Hex) =>
      entries.find((e) => e.slotId === slotId)?.encryptedMeta ?? new Uint8Array(0),
  };
}

describe("listAccessSlots", () => {
  test("lists access slots with their enrollment date", async () => {
    const slotId = deriveSlotId(ADDR, "Y3JlZC1hYWE");
    const accessSlots = await listAccessSlots({ address: ADDR, reader: readerWith([{ slotId, addedAt: 1_700_000_000 }]) });
    expect(accessSlots).toEqual([
      { slotId, addedAt: 1_700_000_000, encryptedMeta: new Uint8Array(0), isThisDevice: false },
    ]);
  });

  test("marks the CURRENT device, so a UI cannot invite you to lock yourself out by accident", async () => {
    // isThisDevice is computed, not stored: the session knows its own credential id, derives its own
    // slot id, and matches. Nothing per-credential lives on chain.
    const slotId = deriveSlotId(ADDR, "Y3JlZC1hYWE");
    const accessSlots = await listAccessSlots({
      address: ADDR,
      reader: readerWith([{ slotId, addedAt: 1_700_000_000 }]),
      thisCredentialId: "Y3JlZC1hYWE",
    });
    expect(accessSlots[0].isThisDevice).toBe(true);
  });

  test("preserves the order the chain returns (stable for the UI)", async () => {
    const a = deriveSlotId(ADDR, "Y3JlZC1hYWE");
    const b = deriveSlotId(ADDR, "Y3JlZC1iYmI");
    const accessSlots = await listAccessSlots({
      address: ADDR,
      reader: readerWith([{ slotId: a, addedAt: 1 }, { slotId: b, addedAt: 2 }]),
    });
    expect(accessSlots.map((d) => d.slotId)).toEqual([a, b]);
  });

  test("carries each access slot's metadata as CIPHERTEXT — the listing never sees a plaintext rp-id", async () => {
    const slotId = deriveSlotId(ADDR, "Y3JlZC1hYWE");
    const encryptedMeta = await encryptSlotMeta(K, slotId, "lifeboat.example");
    const [slot] = await listAccessSlots({ address: ADDR, reader: readerWith([{ slotId, addedAt: 1, encryptedMeta }]) });
    expect(slot.encryptedMeta).toEqual(encryptedMeta);
    expect(new TextDecoder().decode(slot.encryptedMeta)).not.toContain("lifeboat");
  });
});

describe("readAccessSlotRpId", () => {
  test("decrypts an access slot's rp-id, and is the only step that needs K", async () => {
    const slotId = deriveSlotId(ADDR, "Y3JlZC1hYWE");
    const encryptedMeta = await encryptSlotMeta(K, slotId, "lifeboat.example");
    const entry = { slotId, addedAt: 1, encryptedMeta, isThisDevice: false };
    expect(await readAccessSlotRpId(K, entry)).toBe("lifeboat.example");
  });

  test("returns null for an empty or unreadable metadata (never throws in a UI list)", async () => {
    const slotId = deriveSlotId(ADDR, "Y3JlZC1hYWE");
    expect(await readAccessSlotRpId(K, { slotId, addedAt: 1, encryptedMeta: new Uint8Array(0), isThisDevice: false })).toBeNull();
    expect(
      await readAccessSlotRpId(K, { slotId, addedAt: 1, encryptedMeta: new Uint8Array(META_BYTES), isThisDevice: false }),
    ).toBeNull();
  });
});
