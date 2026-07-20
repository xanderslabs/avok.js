import { describe, it, expect, vi } from "vitest";
import { runImportCeremony, runExportCeremony, type PairingTransport } from "../../src/helpers/pairing.js";

function fakeTransport(scans: string[]): PairingTransport & { shown: string[] } {
  const shown: string[] = [];
  let i = 0;
  return { shown, showCode: (c) => shown.push(c), scanCode: async () => scans[i++], stop: () => {} };
}

describe("runImportCeremony (the ENROLLER — the device getting a passkey)", () => {
  it("scans the invite, mints and shows its wrap, then surfaces the SAS", async () => {
    const setup = {
      mintAndWrap: vi.fn(async (_i: string) => ({ wrapQr: "WRAP", sas: "428913" })),
      reject: vi.fn(),
    };
    const t = fakeTransport(["INVITE"]);
    const steps: string[] = [];
    let sas = "";
    await runImportCeremony(setup as never, t, {
      onStep: (s) => steps.push(s),
      confirmSas: async (s) => {
        sas = s;
        return true;
      },
    });
    // ONE code shown, ONE scanned — down from two and one. It returns no account: it was handed no
    // key, so it is not logged in, and the app calls continue() once the holder's write lands.
    expect(t.shown).toEqual(["WRAP"]);
    expect(setup.mintAndWrap).toHaveBeenCalledWith("INVITE");
    expect(sas).toBe("428913");
    expect(steps).toEqual(["await-invite", "send-wrap", "confirm-sas", "done"]);
  });

  it("rejects when the user says the SAS does not match — and BURNS the credential it minted", async () => {
    // Inverted from the three-round ceremony, and this is the cost of the round we removed. The
    // credential is minted inside mintAndWrap, which now runs BEFORE the user answers, so a mismatch
    // leaves a real passkey behind. `reject` marks it burned: W is scoped to (address, slotId) and
    // slotId derives from the credential id, so reusing it would make an intercepted W live the
    // moment a later attempt published a blob. A retry must mint a fresh one.
    const setup = {
      mintAndWrap: vi.fn(async () => ({ wrapQr: "WRAP", sas: "000000" })),
      reject: vi.fn(),
    };
    const t = fakeTransport(["INVITE"]);
    await expect(
      runImportCeremony(setup as never, t, { onStep: () => {}, confirmSas: async () => false }),
    ).rejects.toThrow(/SAS|cancel/i);
    expect(setup.mintAndWrap).toHaveBeenCalled(); // it already ran — that is the trade
    expect(setup.reject).toHaveBeenCalled();
  });
});

describe("runExportCeremony (the HOLDER — the live wallet, which pays)", () => {
  it("shows the invite, scans the wrap, gates the SAS, then writes the access slot", async () => {
    const auth = {
      invite: vi.fn(async () => ({ inviteQr: "INVITE" })),
      receiveWrap: vi.fn(async (_w: string) => ({ sas: "428913" })),
      confirm: vi.fn(async () => ({ slotId: "0xslot", txId: "tx1" })),
      reject: vi.fn(),
    };
    const t = fakeTransport(["WRAP"]);
    const steps: string[] = [];
    await runExportCeremony(auth as never, t, { onStep: (s) => steps.push(s), confirmSas: async () => true });

    expect(t.shown).toEqual(["INVITE"]);
    expect(auth.receiveWrap).toHaveBeenCalledWith("WRAP");
    expect(auth.confirm).toHaveBeenCalled();
    expect(steps).toEqual(["send-invite", "await-wrap", "confirm-sas", "done"]);
  });

  it("rejects when the SAS does not match — and never seals K under the wrapping key", async () => {
    // The wrap is already DECRYPTED by this point, which is exactly why the gate matters: refusing
    // must stop the sealing, not merely stop the decoding.
    const auth = {
      invite: vi.fn(async () => ({ inviteQr: "INVITE" })),
      receiveWrap: vi.fn(async () => ({ sas: "000000" })),
      confirm: vi.fn(),
      reject: vi.fn(),
    };
    const t = fakeTransport(["WRAP"]);
    await expect(
      runExportCeremony(auth as never, t, { onStep: () => {}, confirmSas: async () => false }),
    ).rejects.toThrow(/SAS|cancel/i);
    expect(auth.reject).toHaveBeenCalled();
    expect(auth.confirm).not.toHaveBeenCalled(); // K was never sealed
  });
});
