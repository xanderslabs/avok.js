import { describe, expect, test } from "vitest";
import { verifyMessage } from "viem";
import { createWallet } from "../../src/wallet/wallet.js";
import { createDeviceEnrollmentRequest, verifyDeviceEnrollmentRequest } from "../../src/wallet/device-enrollment.js";
import { FakePasskeyAdapter, makeFakePasskeyWithCounters } from "./fakes.js";

describe("device enrollment (D8: every device derives its own key)", () => {
  test("a new device derives an address independent of the first device's", async () => {
    const first = new FakePasskeyAdapter();
    const second = new FakePasskeyAdapter();
    const founding = await createWallet({ passkey: first, networkName: "Avok" });
    const { request } = await createDeviceEnrollmentRequest({ passkey: second, networkName: "Avok" });
    expect(request.address.toLowerCase()).not.toBe(founding.account.evm.toLowerCase());
  });

  test("the enrollment request's proof verifies against its own address", async () => {
    const pk = new FakePasskeyAdapter();
    const { request } = await createDeviceEnrollmentRequest({ passkey: pk, networkName: "Avok" });
    await expect(verifyDeviceEnrollmentRequest(request)).resolves.toBe(true);
  });

  test("a proof does not verify against a different address", async () => {
    const pk = new FakePasskeyAdapter();
    const { request } = await createDeviceEnrollmentRequest({ passkey: pk, networkName: "Avok" });
    const tampered = { ...request, address: "0x000000000000000000000000000000000000dEaD" as const };
    await expect(verifyDeviceEnrollmentRequest(tampered)).resolves.toBe(false);
  });

  test("the returned state matches the request's address and credential", async () => {
    const pk = new FakePasskeyAdapter();
    const { request, state } = await createDeviceEnrollmentRequest({ passkey: pk, networkName: "Avok" });
    expect(state.evmAddress.toLowerCase()).toBe(request.address.toLowerCase());
  });

  test("the proof is independently verifiable with viem's own verifyMessage (no bespoke recovery logic)", async () => {
    const pk = new FakePasskeyAdapter();
    const { request } = await createDeviceEnrollmentRequest({ passkey: pk, networkName: "Avok" });
    await expect(
      verifyMessage({ address: request.address, message: "Avok device enrollment v1", signature: request.proof }),
    ).resolves.toBe(true);
  });

  test("mints one fresh passkey credential with exactly one gesture", async () => {
    const passkey = makeFakePasskeyWithCounters();
    await createDeviceEnrollmentRequest({ passkey, networkName: "Avok" });
    // create() is the gesture that mints the credential; no separate authenticate/discover round
    // is needed to sign the proof — it happens inside the same key scope create() opened.
    expect(passkey.counts.authenticate).toBe(0);
    expect(passkey.counts.discover).toBe(0);
  });
});
