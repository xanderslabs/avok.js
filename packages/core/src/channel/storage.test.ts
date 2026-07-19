import { describe, it, expect } from "vitest";
import { memoryStorage, saveAccount, loadAccount, clearAccount } from "./storage.js";
import type { SharedAccount } from "./types.js";

// #8: this stored an OIDC session (idToken/accessToken) and dropped it once the id_token's `exp`
// passed. It now stores the public account the popup returned. The expiry cases are gone with the
// tokens — deliberately: expiry existed because a session WAS a bearer token the origin would
// eventually refuse, and restoring a dead one left the app "signed in" until the user tried to sign.
// A public address authorises nothing, so there is nothing to expire. `logout()` is the only exit.

const ACCOUNT: SharedAccount = {
  evmAddress: "0x1234567890123456789012345678901234567890",
  solanaAddress: "AvokSoLDemoAddress11111111111111111111111111",
  credentialId: "credential-id-abc",
};

describe("account storage", () => {
  it("round-trip: saveAccount then loadAccount returns the same account", () => {
    const storage = memoryStorage();
    saveAccount(storage, ACCOUNT);
    expect(loadAccount(storage)).toEqual(ACCOUNT);
  });

  it("round-trip with the EVM address alone (Solana + credentialId are optional)", () => {
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
