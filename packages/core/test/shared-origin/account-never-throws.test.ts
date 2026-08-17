import { describe, it, expect } from "vitest";
import type { StorageAdapter as ChannelStorage } from "../../src/channel/index.js";
import { createSharedOriginConnection } from "../../src/shared-origin/connection.js";
import { makeFakeChannel } from "../client/fakes.js";

/**
 * `account()` MUST NEVER THROW, WHATEVER IS IN STORAGE.
 *
 * It runs at provider mount, before any UI exists. A throw there crashes the app before anything
 * renders, including the `logout()` button, so the user is stranded with no in-app way to recover:
 * only devtools clears it. Returning null is always recoverable, because the next sign-in replaces
 * whatever was there.
 *
 * This was found live, not reasoned about. Shared-origin demos crashed on load against sessions
 * minted before an operator widened its granted scopes, because the restore path validated a claim
 * those older sessions did not carry. The guard that encoded it was deleted with the Solana rail,
 * since the claim in question was `solana_address` and there is no longer any claim to be missing.
 *
 * The lesson outlives the claim: THE NEXT required field will land the same way, on sessions minted
 * before it existed. This asserts the property rather than the old symptom, so it holds for whatever
 * that field turns out to be.
 */
function storageWith(raw: string | null): ChannelStorage {
  const map = new Map<string, string>();
  if (raw !== null) map.set("avok.account", raw);
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

/** Every one of these must produce signed-OUT, never a throw and never a half-built account. */
const UNUSABLE = [
  ["empty storage", null],
  ["unparseable bytes", "not json at all"],
  ["JSON that is not an object", '"a bare string"'],
  ["an object with no address", "{}"],
  ["the literal null", "null"],
  ["an array", "[]"],
] as const;

describe("account() at provider mount", () => {
  for (const [label, raw] of UNUSABLE) {
    it(`reports signed out on ${label}, and does not throw`, () => {
      const conn = createSharedOriginConnection({
        authOrigin: "https://auth.qudi.fi",
        channel: makeFakeChannel(),
        storage: storageWith(raw),
      });
      expect(() => conn.account()).not.toThrow();
      // NOT just "did not throw". `{}` and `[]` both parse, so before this was guarded they shaped
      // into `{ evm: {} }` — an account with an undefined address, reported as SIGNED IN. Assert the
      // outcome, or the test passes on exactly the bug it exists to catch.
      expect(conn.account()).toBeNull();
      expect(conn.status()).toBe(false);
    });
  }

  it("restores a well-formed session", () => {
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel: makeFakeChannel(),
      storage: storageWith('{"evmAddress":"0xabc"}'),
    });
    expect(conn.account()?.evm.address).toBe("0xabc");
    expect(conn.status()).toBe(true);
  });

  it("purges the unusable session so it is not re-read on the next mount", () => {
    const storage = storageWith("{}");
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel: makeFakeChannel(),
      storage,
    });
    expect(storage.get("avok.account")).not.toBeNull();
    conn.account();
    expect(storage.get("avok.account")).toBeNull();
  });

  it("still allows a fresh sign-in after a rejected stored session", async () => {
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel: makeFakeChannel(),
      storage: storageWith("not json at all"),
    });
    expect(conn.account()).toBeNull();
    const acct = await conn.continue();
    expect(acct.evm.address).toMatch(/^0x/);
    expect(conn.status()).toBe(true);
  });
});
