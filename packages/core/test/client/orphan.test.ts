import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  createOwnOriginConnection,
  EnrolmentBlockedError,
  OrphanedCredentialError,
  SlotUnreachableError,
} from "../../src/own-origin/connection.js";
import { makeFakePasskey, type FakePasskey, ACCESS_SLOT_WRITER } from "./fakes.js";
import { ACCESS_VAULT_ABI, VaultUnreadableError } from "../../src/wallet/index.js";
import { decodeFunctionData, hexToBytes } from "viem";
import type { Call } from "../../src/evm/index.js";

/** A chain that actually stores what it is given — needed to prove a repair really lands. */
function capturingVault() {
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
      return { id: "tx-repair" };
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

/** A chain that ANSWERS, honestly, and holds nothing. Every credential it is asked about is an orphan. */
const emptyChain = {
  getAccessSlot: async (_a: Address, _s: Hex) => null,
  getAccessSlotIds: async () => [] as Hex[],
  getAccessSlotAddedAt: async () => 0,
  getAccessSlotMeta: async () => new Uint8Array(0),
};

/** A chain that cannot be reached. It knows nothing about any wallet, and says so. */
const deadChain = {
  getAccessSlot: async () => {
    throw new VaultUnreadableError();
  },
  getAccessSlotIds: async () => [] as Hex[],
  getAccessSlotAddedAt: async () => 0,
  getAccessSlotMeta: async () => new Uint8Array(0),
};

/**
 * Mint an ORPHAN: a credential that exists and whose slot write never landed.
 *
 * NOTE WHAT IT TAKES TO MAKE ONE NOW. A failed write no longer orphans anything — it QUEUES the access slot
 * (write-on-first-value), so it rides the next funded transaction with no user action. An orphan
 * survives only when that queue is LOST too: the holder's tab closed, or a non-durable storage adapter.
 * That is the residual case, and it is exactly what repair exists for. We model it by throwing the
 * queue away — the connection below is discarded and every later check uses a fresh one.
 */
async function orphanedPasskey(): Promise<FakePasskey> {
  const passkey = makeFakePasskey("qudi.fi");
  const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: emptyChain });
  await conn.create();
  await expect(
    conn.addPasskey({
      submit: async () => {
        throw new Error("out of gas");
      },
      hasSlot: async () => false,
      assertCanAffordAccessSlot: async () => {},
      ...ACCESS_SLOT_WRITER,
      ...ACCESS_SLOT_WRITER, // it passed the gate, and the chain died mid-write
    }),
  ).rejects.toThrow(/out of gas/);
  return passkey; // the credential exists; its access slot never landed. That is the orphan.
}

describe("preflight: never mint a credential you cannot finish enrolling", () => {
  it("refuses BEFORE creating the passkey when the chain will not answer", async () => {
    // EVERY orphan is born here: a passkey minted into a write that was never going to land. Creation
    // and the write can never be atomic (the credential must exist before its slot id can be computed),
    // but we CAN refuse to start what we can already see will not finish.
    const passkey = makeFakePasskey("qudi.fi");
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: emptyChain });
    await conn.create();
    const before = passkey.allCredentialIds().length;

    await expect(
      conn.addPasskey({
        submit: async () => {
          throw new Error("unreachable");
        },
        hasSlot: async () => {
          throw new VaultUnreadableError(); // the chain is not answering
        },
        assertCanAffordAccessSlot: async () => {},
        ...ACCESS_SLOT_WRITER,
        ...ACCESS_SLOT_WRITER,
      }),
    ).rejects.toBeInstanceOf(EnrolmentBlockedError);

    // THE POINT: no orphan was created. The user has no mystery passkey in their picker.
    expect(passkey.allCredentialIds()).toHaveLength(before);
  });

  it("does NOT block a fresh, undelegated wallet — that chain answers, it just holds no access slot yet", async () => {
    // The trap in the other direction: a brand-new wallet has no code until its first transaction, so
    // its vault reads come back EMPTY. That is a successful read, not a failure, and it must not stop
    // the user enrolling their second device.
    const passkey = makeFakePasskey("qudi.fi");
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: emptyChain });
    await conn.create();

    const r = await conn.addPasskey({
      submit: async () => ({ id: "tx" }),
      hasSlot: async () => false,
      assertCanAffordAccessSlot: async () => {},
      ...ACCESS_SLOT_WRITER,
      ...ACCESS_SLOT_WRITER,
    });
    expect(r.txId).toBe("tx");
    expect(passkey.allCredentialIds()).toHaveLength(2);
  });

  it("blocks the enrolment ceremony at the HOLDER, before the enroller mints anything", async () => {
    // The enroller has no chain access by design and cannot check anything itself — it is about to mint
    // a credential purely on the strength of the holder's ack. So the holder must check for it, and
    // refuse to send the ack at all if its own write path is dead.
    const passkey = makeFakePasskey("qudi.fi");
    const holder = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: emptyChain });
    await holder.create();

    const enrollerPasskey = makeFakePasskey("independent.example");
    const enroller = createOwnOriginConnection({
      rpId: "independent.example",
      passkey: enrollerPasskey,
      anchorVault: emptyChain,
    });
    const { qr: request } = await enroller.pairing.enroller.begin();

    await expect(
      holder.pairing.holder.authorize({
        qr: request,
        ctx: {
          submit: async () => ({ id: "x" }),
          hasSlot: async () => {
            throw new VaultUnreadableError();
          },
          assertCanAffordAccessSlot: async () => {},
          ...ACCESS_SLOT_WRITER,
          ...ACCESS_SLOT_WRITER,
        },
      }),
    ).rejects.toBeInstanceOf(EnrolmentBlockedError);

    // The enroller never got an ack, so it never minted a credential: no orphan on their domain.
    expect(enrollerPasskey.allCredentialIds()).toHaveLength(0);
  });
});

describe("an orphaned credential", () => {
  it("is reported as an ORPHAN, not as a network problem — retrying will never fix it", async () => {
    const passkey = await orphanedPasskey();
    passkey.setDiscoveredCredential(passkey.allCredentialIds()[1]); // the orphan, not the primary

    const cold = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: emptyChain });
    await expect(cold.continue()).rejects.toBeInstanceOf(OrphanedCredentialError);
  });

  it("carries what a repair needs: the credential, the wallet, and the chain", async () => {
    const passkey = await orphanedPasskey();
    const orphanId = passkey.allCredentialIds()[1];
    passkey.setDiscoveredCredential(orphanId);
    const cold = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: emptyChain });

    const err = (await cold.continue().catch((e) => e)) as OrphanedCredentialError;
    expect(err).toBeInstanceOf(OrphanedCredentialError);
    expect(err.credentialId).toBe(orphanId);
    expect(err.address).toMatch(/^0x/);
    expect(err.anchorChain).toBeGreaterThan(0);
  });

  it("a chain that cannot be READ is still an unreachable slot, NOT an orphan", async () => {
    // The failure this guards: telling a user on a flaky connection that their credential is broken.
    // A read error is evidence of nothing at all.
    const passkey = await orphanedPasskey();
    passkey.setDiscoveredCredential(passkey.allCredentialIds()[1]);
    const cold = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: deadChain });
    await expect(cold.continue()).rejects.toBeInstanceOf(SlotUnreachableError);
  });

  it("names the STATE, offers both remedies, and never blames the network", async () => {
    // The message is the product here. A single read genuinely cannot tell "never written" from
    // "written, still being mined" — both are "no access slot on chain right now" — so it must not guess a
    // cause. It must say what is true (there is no access slot), cover the benign case (the other device may
    // still be finishing), and say plainly that retrying ALONE never creates an access slot. What it must never
    // do is blame the connection: that lie is what sent users into an infinite retry loop.
    const passkey = await orphanedPasskey();
    passkey.setDiscoveredCredential(passkey.allCredentialIds()[1]);
    const cold = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: emptyChain });
    const err = (await cold.continue().catch((e) => e)) as Error;
    expect(err.message).toMatch(/no access slot/i);
    expect(err.message).toMatch(/repair/i);
    expect(err.message).toMatch(/retrying alone will never/i);
    expect(err.message).not.toMatch(/check your connection/i);
  });
});

describe("repairing an orphan through a surviving passkey", () => {
  it("the orphan reaches the wallet afterwards — same ceremony, an existing credential", async () => {
    const vault = capturingVault();

    // A live wallet (the surviving passkey) on one device.
    const holderPasskey = makeFakePasskey("qudi.fi");
    const holder = createOwnOriginConnection({ rpId: "qudi.fi", passkey: holderPasskey, anchorVault: vault });
    const account = await holder.create();

    // A second device mints its credential — and the write dies. THE ORPHAN: a passkey in the picker,
    // with a friendly name, that opens nothing.
    const orphanPasskey = makeFakePasskey("qudi.fi");
    const orphan = createOwnOriginConnection({ rpId: "qudi.fi", passkey: orphanPasskey, anchorVault: vault });
    const { qr: req0 } = await orphan.pairing.enroller.begin();
    const { qr: ack0 } = await holder.pairing.holder.authorize({ qr: req0, ctx: vault });
    await orphan.pairing.enroller.receiveAck(ack0);
    const { qr: wrap0 } = await orphan.pairing.enroller.enroll({ sasConfirmed: true });
    // The holder queues it (write-on-first-value)... and then that holder is discarded, so the queue
    // dies with it. What survives is a credential with no access slot: the orphan.
    await expect(
      holder.pairing.holder.complete({
        qr: wrap0,
        sasConfirmed: true,
        ctx: {
          ...vault,
          submit: async () => {
            throw new Error("out of gas");
          },
        },
      }),
    ).rejects.toThrow(/out of gas/);

    // Confirmed orphaned: the chain answers, and has no access slot for it.
    await expect(orphan.continue()).rejects.toBeInstanceOf(OrphanedCredentialError);

    // REPAIR. The same three codes — only the enroller reuses its credential instead of minting one.
    const { qr: req } = await orphan.pairing.enroller.begin();
    const { qr: ack, sas } = await holder.pairing.holder.authorize({ qr: req, ctx: vault });
    expect((await orphan.pairing.enroller.receiveAck(ack)).sas).toBe(sas);
    const { qr: wrap } = await orphan.pairing.enroller.repair({ sasConfirmed: true });
    await holder.pairing.holder.complete({ qr: wrap, sasConfirmed: true, ctx: vault });

    // No SECOND credential was minted — the orphan was healed, not replaced. (A repair that minted a
    // new passkey would leave the original orphan in the picker forever, still opening nothing.)
    expect(orphanPasskey.allCredentialIds()).toHaveLength(1);

    // And it is a real access slot now: it opens the wallet it always claimed to belong to.
    const healed = createOwnOriginConnection({ rpId: "qudi.fi", passkey: orphanPasskey, anchorVault: vault });
    expect((await healed.continue()).evm.address).toBe(account.evm.address);
  });

  it("refuses to send the repaired wrapping key without the SAS confirmation", async () => {
    const vault = capturingVault();
    const holder = createOwnOriginConnection({
      rpId: "qudi.fi",
      passkey: makeFakePasskey("qudi.fi"),
      anchorVault: vault,
    });
    await holder.create();
    const orphanPasskey = makeFakePasskey("qudi.fi");
    const orphan = createOwnOriginConnection({ rpId: "qudi.fi", passkey: orphanPasskey, anchorVault: vault });

    const { qr: req } = await orphan.pairing.enroller.begin();
    const { qr: ack } = await holder.pairing.holder.authorize({ qr: req, ctx: vault });
    await orphan.pairing.enroller.receiveAck(ack);
    await expect(orphan.pairing.enroller.repair({ sasConfirmed: false as unknown as true })).rejects.toThrow(
      /sasConfirmed/i,
    );
  });
});

describe("an orphan is never counted as a way into the wallet", () => {
  it("accessSlotCount() asks the chain; passkeyCount() counts local credentials and cannot tell them apart", async () => {
    // "You have two ways into this wallet" is the sentence that makes an orphan DANGEROUS: the user
    // completed a ceremony, the credential sits in the picker with a friendly name, and the app calls it
    // safety. It reaches nothing. That number must come from the chain, never from a credential's
    // existence.
    const vault = capturingVault();
    const passkey = makeFakePasskey("qudi.fi");
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: vault });
    await conn.create();

    await expect(
      conn.addPasskey({
        submit: async () => {
          throw new Error("out of gas");
        },
        hasSlot: async () => false,
        assertCanAffordAccessSlot: async () => {},
        ...ACCESS_SLOT_WRITER,
        ...ACCESS_SLOT_WRITER,
      }),
    ).rejects.toThrow(/out of gas/);

    // The credential exists locally — and opens nothing. If the app renders THIS number, it lies.
    expect(conn.passkeyCount()).toBe(2);

    // The honest number: the primary derives K from its own PRF and holds no slot, and the orphan's
    // slot never landed. Zero access slots are on chain.
    expect(await conn.accessSlotCount()).toBe(0);
  });

  it("accessSlotCount() counts an access slot once it really lands", async () => {
    const vault = capturingVault();
    const passkey = makeFakePasskey("qudi.fi");
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: vault });
    await conn.create();
    await conn.addPasskey({
      submit: vault.submit,
      hasSlot: vault.hasSlot,
      assertCanAffordAccessSlot: async () => {},
      ...ACCESS_SLOT_WRITER,
      ...ACCESS_SLOT_WRITER,
    });
    expect(await conn.accessSlotCount()).toBe(1);
  });
});
