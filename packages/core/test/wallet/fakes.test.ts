import { describe, expect, test } from "vitest";
import { FakePasskeyAdapter } from "./fakes.js";

describe("FakePasskeyAdapter", () => {
  test("create then authenticate returns the same PRF output", async () => {
    const pk = new FakePasskeyAdapter();
    const userHandle = crypto.getRandomValues(new Uint8Array(32));
    const reg = await pk.create("Avok Wallet · Test", userHandle);
    const again = await pk.authenticate(reg.credentialId);
    expect(new Uint8Array(again)).toEqual(new Uint8Array(reg.prfOutput));
  });

  test("discover surfaces the credential it was created with", async () => {
    const pk = new FakePasskeyAdapter();
    const userHandle = crypto.getRandomValues(new Uint8Array(32));
    const reg = await pk.create("Avok Wallet · Test", userHandle);
    const discovered = await pk.discover();
    expect(discovered.credentialId).toBe(reg.credentialId);
    expect(new Uint8Array(discovered.userHandle)).toEqual(new Uint8Array(userHandle));
  });
});
