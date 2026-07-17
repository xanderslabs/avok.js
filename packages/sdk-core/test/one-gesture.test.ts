import { describe, it, expect } from "vitest";
import type { Call } from "@avokjs/evm-txengine";
import { createOwnOriginConnection } from "../src/own-origin/connection.js";
import { makeFakePasskey, ACCESS_SLOT_WRITER } from "./fakes.js";

/**
 * ONE USER ACTION = ONE PASSKEY GESTURE.
 *
 * `authenticate()` IS the biometric prompt: every call to it is a fingerprint/FaceID confirmation the
 * user has to make. Counting it is the only honest way to test this, because the bug was never visible
 * in the results — the access slot was written correctly, the user was just asked twice.
 *
 * Enrolment needs the wallet key TWICE (seal the access slot's blob under K, then sign the transaction that
 * carries it). Those used to be two separate key scopes, so adding ONE device asked for TWO
 * confirmations. Beyond the annoyance, that trains people to approve prompts reflexively — the exact
 * habit a malicious second prompt relies on. These tests fail the moment the count regresses.
 *
 * NOTE the deliberate exception: minting a NEW credential is its own WebAuthn ceremony (`create()`),
 * because you are creating a passkey. That is inherent, not a defect, and is counted separately.
 */
function countingPasskey(rpId = "qudi.fi") {
  const inner = makeFakePasskey(rpId, 11);
  const count = { authenticate: 0, create: 0 };
  const spy = Object.create(inner) as typeof inner & { count: typeof count };
  spy.authenticate = async (id: string, t?: string[]) => {
    count.authenticate++; // ← a biometric prompt
    return inner.authenticate(id, t);
  };
  spy.create = async (...args: Parameters<typeof inner.create>) => {
    count.create++;
    return inner.create(...args);
  };
  spy.count = count;
  return spy;
}

const ctx = {
  submit: async (_calls: Call[], _o: { chainId: number }) => ({ id: "tx" }),
  hasSlot: async (): Promise<boolean> => false,
  assertCanAffordAccessSlot: async (): Promise<void> => {},
  ...ACCESS_SLOT_WRITER,
};

describe("one user action = one passkey gesture", () => {
  it("addPasskey unlocks the wallet ONCE — not once to seal and again to sign", async () => {
    const passkey = countingPasskey();
    const conn = createOwnOriginConnection({ rpId: "qudi.fi", passkey, anchorChainId: "eip155:10" });
    await conn.create();

    passkey.count.authenticate = 0;
    passkey.count.create = 0;

    await conn.addPasskey(ctx);

    // Sealing the blob and signing the write happen in ONE key scope.
    expect(passkey.count.authenticate).toBe(1);
    // Minting the new credential is its own ceremony — inherent, you are creating a passkey.
    expect(passkey.count.create).toBe(1);
  });
});
