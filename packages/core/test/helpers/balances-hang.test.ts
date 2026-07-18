import { describe, it, expect, vi } from "vitest";

/**
 * A HANGING Solana RPC must not wedge the app.
 *
 * `readSolanaBalances` promises that "a dead RPC ... resolves to 0". That was only true for an RPC
 * that ERRORS. An RPC that simply never answers never rejects either — so `.catch(() => 0n)` never
 * fired, `Promise.all` never settled, and the balances spinner ran forever. Live: the public Solana
 * endpoints hang (no response, no error) on exactly the mint-filtered `getTokenAccountsByOwner`
 * this function issues, and Home's Solana balances spun indefinitely.
 *
 * The fix time-boxes every read with an AbortSignal. `AbortSignal.timeout` uses the platform clock,
 * which vitest's fake timers do not drive — so rather than wait out a real timeout, we assert the
 * two properties that together make a hang impossible: an abort signal is handed to EVERY read, and
 * an aborted read degrades to 0 instead of propagating.
 */

const sendArgs: unknown[] = [];

vi.mock("@solana/kit", async (orig) => {
  const real = await orig<typeof import("@solana/kit")>();
  const hangingSend = (args: unknown) => {
    sendArgs.push(args);
    // A request that only ever settles by being aborted — i.e. a hanging endpoint.
    const signal = (args as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
    return new Promise((_resolve, reject) => {
      if (!signal) return; // no signal → hangs forever, exactly the bug
      signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
    });
  };
  return {
    ...real,
    createSolanaRpc: () => ({
      getBalance: () => ({ send: hangingSend }),
      getMultipleAccounts: () => ({ send: hangingSend }),
    }),
  };
});

import { readSolanaBalances } from "../../src/helpers/balances.js";

describe("readSolanaBalances against a hanging RPC", () => {
  it("time-boxes every read, so a hang cannot freeze the balances", async () => {
    // The point: this await RETURNS. Before the fix it never would have.
    //
    // The guard is 30s, not 20s: the native read and the SPL reads run in sequence, so a fully dead
    // endpoint costs two 10s time-boxes (~20s) before everything degrades to 0. Slow, but bounded —
    // which is the whole property under test. (A tighter guard fails on the timing, not the fix.)
    const out = await Promise.race([
      readSolanaBalances("mainnet", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
      new Promise((_r, reject) => setTimeout(() => reject(new Error("readSolanaBalances hung")), 30_000)),
    ]);

    expect(sendArgs.length).toBeGreaterThan(0);
    for (const args of sendArgs) {
      expect((args as { abortSignal?: AbortSignal }).abortSignal).toBeInstanceOf(AbortSignal);
    }

    // A dead RPC degrades to zero balances — renderable — rather than an unresolvable promise.
    const balances = out as Awaited<ReturnType<typeof readSolanaBalances>>;
    expect(balances[0].symbol).toBe("SOL");
    for (const b of balances) expect(b.base).toBe(0n);
  }, 40_000);
});
