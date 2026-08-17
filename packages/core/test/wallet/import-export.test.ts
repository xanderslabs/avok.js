import { describe, expect, it } from "vitest";
import { createWallet, exportWallet } from "../../src/wallet/wallet.js";
import { FakePasskeyAdapter } from "./fakes.js";

describe("exportWallet", () => {
  it("export requires explicit confirmation", async () => {
    const passkey = new FakePasskeyAdapter();
    const { state } = await createWallet({ passkey, networkName: "Avok" });
    // @ts-expect-error confirmExport must be the literal true
    await expect(exportWallet({ state, passkey, confirmExport: false })).rejects.toThrow();
  });
});
