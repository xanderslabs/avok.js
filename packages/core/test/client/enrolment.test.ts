import { describe, expect, it } from "vitest";
import { readAccessSlotRpId, reconstructFromKey } from "../../src/wallet/index.js";
import { capturingVault, twoSides, enrolAccessSlot, openAccessSlot } from "./access-slot-harness.js";

describe("passkey enrolment (one ceremony, whoever the enroller is)", () => {
  it("enrols a passkey, and the wallet key never crosses the wire", async () => {
    const vault = capturingVault();
    const { holder, enroller, passkeyEnroller } = twoSides(vault);
    const account = await holder.create();

    const { wire, rpId, slotId, txId } = await enrolAccessSlot(holder, enroller, vault);
    expect(rpId).toBe("independent.example");
    expect(txId).toBe("tx-enrol"); // the HOLDER paid — the enroller needs no chain access at all

    // THE PROPERTY, and the assertion that actually carries it: the enroller ends the ceremony with NO
    // WALLET. It received no key, so there is nothing for it to be logged in with. (The deleted
    // K-shipping ceremony left the new device logged in precisely BECAUSE it shipped the key.)
    expect(enroller.status()).toBe(false);
    expect(enroller.account()).toBeNull();

    // The passkey is real: the enrolled credential opens its slot and reaches the wallet key, and that key
    // rebuilds the SAME wallet.
    const K = await openAccessSlot(passkeyEnroller, vault, account.evm.address, slotId);
    expect(reconstructFromKey(Uint8Array.from(K)).evmAddress).toBe(account.evm.address);

    // A plaintext scan of the wire, for completeness. NOTE what it does NOT prove: every payload is
    // AES-encrypted, so K would not appear here even in a flow that genuinely sent it. It guards
    // against a future refactor putting key material in a payload's clear fields — the assertion above
    // is the one that carries the property.
    const kb = Buffer.from(K);
    for (const qr of wire) {
      expect(qr).not.toContain(kb.toString("base64"));
      expect(Buffer.from(qr, "base64url").includes(kb)).toBe(false);
    }
  });

  it("the enrolled credential logs in afterwards with continue() — no key was handed to it", async () => {
    const vault = capturingVault();
    const { holder, enroller } = twoSides(vault);
    const account = await holder.create();
    await enrolAccessSlot(holder, enroller, vault);

    // The one behavioural cost of deleting K-transport: the new side is not instantly logged in. It
    // logs in the ordinary way — read its blob, decrypt with its own PRF — once the write has landed.
    expect((await enroller.continue()).evm.address).toBe(account.evm.address);
    expect(enroller.status()).toBe(true);
  });

  it("the enroller refuses to send its wrapping key without the SAS confirmation", async () => {
    const vault = capturingVault();
    const { holder, enroller } = twoSides(vault);
    await holder.create();

    const { qr: request } = await enroller.pairing.enroller.begin();
    const { qr: ack } = await holder.pairing.holder.authorize({ qr: request, ctx: vault });
    await enroller.pairing.enroller.receiveAck(ack);

    await expect(enroller.pairing.enroller.enroll({ sasConfirmed: false as unknown as true })).rejects.toThrow(
      /sasConfirmed/i,
    );
  });

  it("the holder refuses to seal K under a wrapping key whose SAS was never confirmed", async () => {
    // THE ATTACK this stops: a MITM substitutes its OWN wrapping key, the holder seals K under it, and
    // the attacker now has a passkey into the wallet. The 6 digits the user compared rule that out.
    const vault = capturingVault();
    const { holder, enroller } = twoSides(vault);
    await holder.create();

    const { qr: request } = await enroller.pairing.enroller.begin();
    const { qr: ack } = await holder.pairing.holder.authorize({ qr: request, ctx: vault });
    await enroller.pairing.enroller.receiveAck(ack);
    const { qr: wrap } = await enroller.pairing.enroller.enroll({ sasConfirmed: true });

    await expect(
      holder.pairing.holder.complete({ qr: wrap, sasConfirmed: false as unknown as true, ctx: vault }),
    ).rejects.toThrow(/sasConfirmed/i);
  });

  it("the roster names the enrolling domain", async () => {
    const vault = capturingVault();
    const { holder, enroller, passkeyEnroller } = twoSides(vault);
    const account = await holder.create();
    const { slotId } = await enrolAccessSlot(holder, enroller, vault);

    // The trust surface, made visible: the user sees WHICH domain holds a key to their wallet.
    const K = await openAccessSlot(passkeyEnroller, vault, account.evm.address, slotId);
    const accessSlots = await holder.listAccessSlots();
    expect(await Promise.all(accessSlots.map((d) => readAccessSlotRpId(K, d)))).toContain("independent.example");
  });

  it("listAccessSlots() names the enrolling domain — the trust surface, visible to an app with no key", async () => {
    // THE SEAM THAT MAKES THE ROSTER USABLE. listAccessSlots carries the metadata as CIPHERTEXT (it is
    // public on chain, and the listing stays key-free by design), and decrypting it needs the wallet
    // key — which an app can never hold. So the decrypt happens inside the sandbox and the app gets
    // plain strings. Without this, the whole rp-id roster is unreachable by any real UI.
    const vault = capturingVault();
    const { holder, enroller } = twoSides(vault);
    await holder.create();
    await enrolAccessSlot(holder, enroller, vault);

    const accessSlots = await holder.listAccessSlots();
    expect(accessSlots).toHaveLength(1);
    expect(accessSlots[0].rpId).toBe("independent.example"); // "this domain can reach my wallet key"
    expect(accessSlots[0].isThisDevice).toBe(false);
  });

  it("listAccessSlots() renders an unreadable access slot as 'unknown', never as an error", async () => {
    // A passkey enrolled before metadata existed, or written by another implementation. One bad access slot must
    // not blank the user's whole list — that would hide the very trust surface this exists to show.
    const vault = capturingVault();
    // A chain that stores the access slot but serves NO metadata back for it.
    const blind = { ...vault, getAccessSlotMeta: async () => new Uint8Array(0) };
    const { holder, enroller } = twoSides(blind);
    await holder.create();
    await enrolAccessSlot(holder, enroller, blind);

    const accessSlots = await holder.listAccessSlots();
    expect(accessSlots).toHaveLength(1);
    expect(accessSlots[0].rpId).toBeNull(); // a UI renders "unknown domain" — it does not throw
  });

  it("a second ceremony mints a second credential, so the roster grows honestly", async () => {
    const vault = capturingVault();
    const { holder, enroller } = twoSides(vault);
    await holder.create();
    await enrolAccessSlot(holder, enroller, vault);
    await enrolAccessSlot(holder, enroller, vault);
    expect(await holder.listAccessSlots()).toHaveLength(2);
  });
});
