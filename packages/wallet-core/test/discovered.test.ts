import { describe, it, expect } from "vitest";
import { decodeUserHandle, encodeAccessHandle } from "../src/passkey/label.js";
import { FakePasskeyAdapter } from "./fakes.js";

describe("PasskeyAdapter discover surfaces the credential's user handle", () => {
  it("returns the opaque handle, which decodes to evm + anchor chain for a secondary", async () => {
    const pk = new FakePasskeyAdapter();
    const evm = "0x52908400098527886E0F7030069857D2E4169EE7" as const;
    await pk.create("label", encodeAccessHandle(evm, 8453));
    const d = await pk.discover();
    expect(decodeUserHandle(d.userHandle)).toEqual({ kind: "secondary", evm, anchorChain: 8453 });
  });
});
