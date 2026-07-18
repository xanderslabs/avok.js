import { describe, it, expect, vi } from "vitest";
import {
  createAuthorizeController,
  createSetupController,
} from "../src/pairing/controller.js";
import type { FullAvokClient } from "@avokjs/core";

type Pairing = FullAvokClient["pairing"];

/** A spy pairing surface that records exactly which verbs the controller invoked. */
function spyPairing() {
  const complete = vi.fn(async (_a: { qr: string; sasConfirmed: true }) => ({ slotId: "0xslot", txId: "tx1" }));
  const enroll = vi.fn(async (_a: { sasConfirmed: true }) => ({ qr: "wrap-qr", rpId: "example.test" }));
  const pairing = {
    holder: {
      authorize: vi.fn(async (_a: { qr: string }) => ({ qr: "ack-qr", sas: "123456" })),
      complete,
    },
    enroller: {
      begin: vi.fn(async () => ({ qr: "request-qr" })),
      receiveAck: vi.fn(async (_qr: string) => ({ sas: "123456" })),
      enroll,
    },
  } as unknown as Pairing;
  return { pairing, complete, enroll };
}

describe("web enrolment demo — the SAS gate", () => {
  it("holder: confirm() scans the wrap and asserts sasConfirmed:true when writing the access slot", async () => {
    const { pairing, complete } = spyPairing();
    const a = createAuthorizeController(pairing);
    const { sas } = await a.authorize("request-qr");
    expect(sas).toBe("123456");
    expect(a.status).toBe("awaiting-confirm");

    const { txId } = await a.confirm("wrap-qr");
    expect(txId).toBe("tx1");
    expect(complete).toHaveBeenCalledWith({ qr: "wrap-qr", sasConfirmed: true });
    expect(a.status).toBe("done");
  });

  it("holder: reject() never writes an access slot, and blocks a later confirm()", async () => {
    // The attack the gate exists for: a MITM's wrapping key would have us seal K under it. If the user
    // says the codes did not match, nothing may be sealed — not now, not by a later call.
    const { pairing, complete } = spyPairing();
    const a = createAuthorizeController(pairing);
    await a.authorize("request-qr");

    a.reject();
    expect(a.status).toBe("rejected");
    expect(complete).not.toHaveBeenCalled();
    await expect(a.confirm("wrap-qr")).rejects.toThrow(/only valid/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("enroller: confirm() mints the credential and asserts sasConfirmed:true when sending its key", async () => {
    const { pairing, enroll } = spyPairing();
    const b = createSetupController(pairing);
    await b.begin();
    const { sas } = await b.receiveAck("ack-qr");
    expect(sas).toBe("123456");

    const { wrapQr } = await b.confirm();
    expect(wrapQr).toBe("wrap-qr");
    expect(enroll).toHaveBeenCalledWith({ sasConfirmed: true });
    expect(b.status).toBe("done");
  });

  it("enroller: reject() never mints a credential, and blocks a later confirm()", async () => {
    // Rejecting BEFORE enroll() also means no orphan: no passkey is created that could never be
    // finished. The credential is minted inside enroll(), which the gate guards.
    const { pairing, enroll } = spyPairing();
    const b = createSetupController(pairing);
    await b.begin();
    await b.receiveAck("ack-qr");

    b.reject();
    expect(enroll).not.toHaveBeenCalled();
    await expect(b.confirm()).rejects.toThrow(/only valid/);
    expect(enroll).not.toHaveBeenCalled();
  });
});
