import { describe, it, expect } from "vitest";
import { memoryStorage, saveAccount, loadAccount, clearAccount } from "../../src/channel/storage.js";
import type { SharedAccount } from "../../src/channel/types.js";

// This stores the public account the popup returned, and nothing else. There are deliberately no
// expiry cases: expiry belongs to a bearer token the origin would eventually refuse, and a public
// address authorises nothing. `logout()` is the only exit.

const ACCOUNT: SharedAccount = {
  evmAddress: "0x1234567890123456789012345678901234567890",
  credentialId: "credential-id-abc",
};

describe("account storage", () => {
  it("round-trip: saveAccount then loadAccount returns the same account", () => {
    const storage = memoryStorage();
    saveAccount(storage, ACCOUNT);
    expect(loadAccount(storage)).toEqual(ACCOUNT);
  });

  it("round-trip with the EVM address alone (credentialId is optional)", () => {
    const storage = memoryStorage();
    const minimal: SharedAccount = { evmAddress: ACCOUNT.evmAddress };
    saveAccount(storage, minimal);
    expect(loadAccount(storage)).toEqual(minimal);
  });

  it("clearAccount removes the account", () => {
    const storage = memoryStorage();
    saveAccount(storage, ACCOUNT);
    clearAccount(storage);
    expect(loadAccount(storage)).toBeNull();
  });

  it("loadAccount returns null if no account exists", () => {
    expect(loadAccount(memoryStorage())).toBeNull();
  });

  it("loadAccount returns null if JSON.parse throws", () => {
    // Defensive: a corrupted value must read as "not connected", never throw into the app.
    const storage = memoryStorage();
    storage.set("avok.account", "{ invalid json");
    expect(loadAccount(storage)).toBeNull();
  });
});
