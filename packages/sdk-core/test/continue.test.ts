import { describe, it, expect, vi } from "vitest";
import { createOwnOriginConnection, OrphanedCredentialError, SlotUnreachableError } from "../src/own-origin/connection.js";
import { makeFakePasskey, ACCESS_SLOT_WRITER } from "./fakes.js";

/**
 * One login ceremony, two paths — the thing this task builds. A single discoverable assertion
 * returns the credential id, the user handle and the PRF output together; the handle's kind byte
 * picks the path. These tests drive continue() for real.
 */
describe("continue() path selection", () => {
  it("a primary re-derives the SAME wallet and never touches the network", async () => {
    // Regression guard for the founder's lost wallet (2026-07-09): a primary that logs out must log
    // back in with no chain read, no vault, no fee — offline, on every provider.
    const passkey = makeFakePasskey("qudi.fi", 7); // fixed seed ⇒ fixed PRF ⇒ same wallet
    const created = await createOwnOriginConnection({ rpId: "qudi.fi", passkey }).create();

    // The vault stub is a spy that MUST never be called on the primary path. Injecting it proves the
    // claim structurally: if continue() ever read the vault for a primary, this throws.
    const getAccessSlot = vi.fn(async () => {
      throw new Error("primary must not read the vault");
    });
    const b = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: { getAccessSlot } });
    const resumed = await b.continue();

    // Assert BOTH: the wallet is identical, AND no network was touched. "No chain read" is a
    // load-bearing product claim, not an implementation detail.
    expect(resumed.evm.address).toBe(created.evm.address);
    expect(resumed.solana.address).toBe(created.solana.address);
    expect(getAccessSlot).not.toHaveBeenCalled();
    expect(b.status()).toBe(true);
  });

  it("a secondary whose vault read FAILS reports a network problem, not a missing wallet", async () => {
    const passkey = makeFakePasskey("qudi.fi", 9);
    const conn1 = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorChainId: "eip155:10" });
    await conn1.create();
    // Enrol a secondary so discover() can present a SECONDARY handle (its blob lives on chain). The
    // write target is a throwaway — this test is about the READ failing at continue().
    await conn1.addPasskey({ submit: async () => ({ id: "tx" }), hasSlot: async () => false, assertCanAffordAccessSlot: async () => {},
    ...ACCESS_SLOT_WRITER, ...ACCESS_SLOT_WRITER });
    passkey.setDiscoveredCredential(passkey.allCredentialIds()[1]);

    const conn2 = createOwnOriginConnection({
      rpId: "qudi.fi",
      passkey,
      anchorVault: { getAccessSlot: async () => { throw new Error("RPC down"); } },
    });

    // Assert the TYPE, not a message regex: a regex would also pass for a plain Error carrying the
    // same text, which is exactly the confusion that cost a founder a wallet.
    await expect(conn2.continue()).rejects.toBeInstanceOf(SlotUnreachableError);
    // ...and the two failures are genuinely distinguishable to a caller.
    await expect(conn2.continue()).rejects.not.toThrow(/no wallet found/i);
  });

  it("a secondary whose blob is ABSENT from a READABLE chain is an ORPHAN, not a network failure", async () => {
    const passkey = makeFakePasskey("qudi.fi", 11);
    const conn1 = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorChainId: "eip155:10" });
    await conn1.create();
    await conn1.addPasskey({ submit: async () => ({ id: "tx" }), hasSlot: async () => false, assertCanAffordAccessSlot: async () => {},
    ...ACCESS_SLOT_WRITER, ...ACCESS_SLOT_WRITER });
    passkey.setDiscoveredCredential(passkey.allCredentialIds()[1]);

    // This used to expect SlotUnreachableError. That was the conflation: a chain that ANSWERED and
    // holds no access slot is not a network failure, and "check your connection and retry" is advice that can
    // never succeed. It is an orphan — the write never landed (or has not landed YET, which the error
    // message covers). Still never "no wallet found for this passkey": the wallet is fine.
    const conn2 = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorVault: { getAccessSlot: async () => null } });
    const err = (await conn2.continue().catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(OrphanedCredentialError);
    expect(err.message).not.toMatch(/no wallet found/i);
  });

  it("SlotUnreachableError reads as a network problem, never a missing wallet", () => {
    const e = new SlotUnreachableError();
    expect(e).toBeInstanceOf(SlotUnreachableError);
    expect(e.message).toMatch(/access-slot chain|unreachable|connection/i);
    expect(e.message).not.toMatch(/no wallet found/i);
  });
});
