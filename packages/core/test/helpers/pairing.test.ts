import { describe, it, expect, vi } from "vitest";
import { runImportCeremony, runExportCeremony, type PairingTransport } from "../../src/helpers/pairing.js";

function fakeTransport(scans: string[]): PairingTransport & { shown: string[] } {
  const shown: string[] = [];
  let i = 0;
  return { shown, showCode: (c) => shown.push(c), scanCode: async () => scans[i++], stop: () => {} };
}

describe("runImportCeremony (the ENROLLER — the device getting a passkey)", () => {
  it("shows request, scans ack, surfaces SAS, then shows its wrap", async () => {
    const setup = {
      begin: vi.fn(async () => ({ requestQr: "REQ" })),
      receiveAck: vi.fn(async (_a: string) => ({ sas: "428913" })),
      confirm: vi.fn(async () => ({ wrapQr: "WRAP" })),
      reject: vi.fn(),
    };
    const t = fakeTransport(["ACK"]);
    const steps: string[] = [];
    let sas = "";
    await runImportCeremony(setup as never, t, {
      onStep: (s) => steps.push(s),
      confirmSas: async (s) => { sas = s; return true; },
    });
    // It SHOWS two codes now (request, then its wrapping key) and scans one (the ack). It returns no
    // account: it was handed no key, so it is not logged in — the app calls continue() afterwards.
    expect(t.shown).toEqual(["REQ", "WRAP"]);
    expect(setup.receiveAck).toHaveBeenCalledWith("ACK");
    expect(sas).toBe("428913");
    expect(setup.confirm).toHaveBeenCalledWith();
    expect(steps).toEqual(["show-request", "scan-ack", "confirm-sas", "show-wrap", "done"]);
  });

  it("rejects when the user says the SAS does not match — and mints no credential", async () => {
    // Rejecting before confirm() means no passkey is created at all, so no orphaned credential is left
    // behind: the credential is minted inside confirm(), which the gate guards.
    const setup = { begin: vi.fn(async () => ({ requestQr: "REQ" })), receiveAck: vi.fn(async () => ({ sas: "000000" })), confirm: vi.fn(), reject: vi.fn() };
    const t = fakeTransport(["ACK"]);
    await expect(runImportCeremony(setup as never, t, { onStep: () => {}, confirmSas: async () => false }))
      .rejects.toThrow(/SAS|cancel/i);
    expect(setup.reject).toHaveBeenCalled();
    expect(setup.confirm).not.toHaveBeenCalled();
  });
});

describe("runExportCeremony (the HOLDER — the live wallet, which pays)", () => {
  it("scans request, shows ack, gates SAS, then scans the wrap and writes the access slot", async () => {
    const auth = {
      authorize: vi.fn(async (_r: string) => ({ ackQr: "ACK", sas: "428913" })),
      confirm: vi.fn(async (_w: string) => ({ slotId: "0xslot", txId: "tx1" })),
      reject: vi.fn(),
    };
    const t = fakeTransport(["REQ", "WRAP"]);
    const steps: string[] = [];
    await runExportCeremony(auth as never, t, { onStep: (s) => steps.push(s), confirmSas: async () => true });
    expect(auth.authorize).toHaveBeenCalledWith("REQ");
    expect(t.shown).toEqual(["ACK"]); // only the ack is shown now — there is no grant to reveal
    expect(auth.confirm).toHaveBeenCalledWith("WRAP");
    expect(steps).toEqual(["scan-request", "show-ack", "confirm-sas", "scan-wrap", "done"]);
  });

  it("rejects when the SAS does not match — and never seals K under the wrapping key", async () => {
    // THE ATTACK: a MITM substitutes its own wrapping key and we seal K under it, handing it a passkey.
    // A rejected SAS must mean nothing is ever sealed.
    const auth = { authorize: vi.fn(async () => ({ ackQr: "ACK", sas: "000000" })), confirm: vi.fn(), reject: vi.fn() };
    const t = fakeTransport(["REQ"]);
    await expect(runExportCeremony(auth as never, t, { onStep: () => {}, confirmSas: async () => false }))
      .rejects.toThrow(/SAS|cancel/i);
    expect(auth.reject).toHaveBeenCalled();
    expect(auth.confirm).not.toHaveBeenCalled();
  });
});
