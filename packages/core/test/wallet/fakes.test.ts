import { describe, expect, test } from "vitest";
import { getAddress } from "viem";
import { decodeUserHandle, encodeAccessHandle } from "../../src/wallet/passkey/label.js";
import { FakePasskeyAdapter } from "./fakes.js";

const ADDR = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");

describe("FakePasskeyAdapter", () => {
  test("create then authenticate returns the same PRF output", async () => {
    const pk = new FakePasskeyAdapter();
    const reg = await pk.create("Qudi Wallet · 1a2b…9f3c", encodeAccessHandle(ADDR, 10));
    const again = await pk.authenticate(reg.credentialId);
    expect(new Uint8Array(again)).toEqual(new Uint8Array(reg.prfOutput));
  });

  test("discover surfaces the handle it was created with", async () => {
    const pk = new FakePasskeyAdapter();
    await pk.create("Qudi Wallet · 1a2b…9f3c", encodeAccessHandle(ADDR, 10));
    expect(decodeUserHandle((await pk.discover()).userHandle)).toEqual({
      kind: "secondary",
      evm: ADDR,
      anchorChain: 10,
    });
  });
});
