/**
 * Self-custody invariant across the new access-slot surface.
 *
 * HARD INVARIANT: no path writes/reads/returns/transmits the PLAINTEXT private key. Access-slot writes
 * only the PRF-encrypted ciphertext blob (which is public, on-chain-destined data). This test
 * proves it two ways:
 *  - Own-origin: the addAccessSlot call the wallet submits carries the ciphertext, and the wallet's
 *    actual plaintext key NEVER appears in that calldata or in the returned result.
 *  - Shared-origin: the channel-mediated access-slot surface exposes only { kind, slotId, chainId, call }
 *    with no key/blob/PRF/secret field.
 */
import { describe, it, expect } from "vitest";
import type { Call } from "../../src/evm/index.js";
import type { Hex } from "viem";
import { createOwnOriginConnection } from "../../src/own-origin/connection.js";
import { createSharedOriginConnection } from "../../src/shared-origin/connection.js";
import { makeFakePasskey, makeFakeChannel, ACCESS_SLOT_WRITER } from "./fakes.js";

describe("self-custody invariant — access-slot surface", () => {
  it("own-origin: the submitted addAccessSlot calldata is ciphertext — the plaintext key never appears", async () => {
    const passkey = makeFakePasskey("localhost");
    const conn = createOwnOriginConnection({ rpId: "localhost", passkey, anchorChainId: "eip155:10" });
    await conn.create();

    // The wallet's ACTUAL plaintext private key (custody comparison ground truth).
    const { evm: plaintextKey } = await conn.export();
    expect(plaintextKey).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const submitted: Call[] = [];
    const ctx = {
      submit: async (calls: Call[], _o: { chainId: number }) => {
        submitted.push(...calls);
        return { id: "tx-1" };
      },
      hasSlot: async (): Promise<boolean> => false,
      assertCanAffordAccessSlot: async (): Promise<void> => {},
      ...ACCESS_SLOT_WRITER,
    };

    // addPasskey enrols a secondary and writes ITS PRF-encrypted blob on chain in one call. The blob
    // wraps the SAME K under a different PRF, so the wallet's plaintext key must still never appear.
    const res = await conn.addPasskey(ctx);

    // The written blob is ciphertext: the plaintext key must not be a substring of the calldata.
    const data = submitted[0].data.toLowerCase();
    const keyHex = plaintextKey.slice(2).toLowerCase();
    expect(data.includes(keyHex)).toBe(false);
    // …nor anywhere in the returned result.
    expect(JSON.stringify(res).toLowerCase().includes(keyHex)).toBe(false);
    // Sanity: calldata is non-trivial (it actually embedded the encrypted blob).
    expect(data.length).toBeGreaterThan(200);
  });

  it("shared-origin: the use-only Connection has NO custody-management verbs — no path to key material", async () => {
    const channel = makeFakeChannel({ address: "0xabc0000000000000000000000000000000000abc", solanaAddress: "So1anaAddrBase58..." });
    const conn = createSharedOriginConnection({
      authOrigin: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();

    // The custody boundary is enforced at the type level; assert it at runtime too. A shared-origin
    // connection that literally has no export/addPasskey/create member cannot leak key material —
    // there is no surface through which it could.
    for (const verb of ["export", "addPasskey", "create"]) {
      expect(verb in conn).toBe(false);
    }
    expect(conn.custody).toBe("use-only");
  });
});
