import { describe, it, expect, vi } from "vitest";
import { readBalances } from "../../src/helpers/balances.js";

/**
 * A HANGING RPC MUST NOT WEDGE THE APP.
 *
 * `readBalances` promises that "failed reads resolve to a 0 balance so one dead RPC never blanks the
 * whole list". That promise is only true for an RPC that REJECTS. An endpoint that accepts the
 * connection and then answers nothing never rejects on its own, so without a bound `.catch` never
 * fires, `Promise.all` never settles, and the balances spinner runs forever: an unresolvable promise
 * the UI cannot render.
 *
 * This is not hypothetical. It happened on the Solana path, whose RPC client had no default timeout
 * and needed an explicit `AbortSignal.timeout`. That path and its regression test were deleted with
 * the Solana rail. The LESSON is chain-independent, so it is re-encoded here against the EVM path.
 *
 * What actually bounds the EVM read is viem's `http` transport, which attaches a 10s abort signal by
 * default. That is a property of a DEPENDENCY, not of this code, so it is asserted rather than
 * assumed: if viem drops the default, or a caller passes `http(url, { timeout: 0 })`, these go red.
 */
describe("a hanging RPC cannot wedge readBalances", () => {
  const ADDR = "0x1111111111111111111111111111111111111111";

  it("every request carries an abort signal, which is what bounds a hang", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    // Reject like a real fetch does on abort. A hang is modelled as "resolves only when aborted".
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Promise<Response>((_resolve, reject) => {
        const s = init?.signal;
        if (!s) return; // no signal: nothing can ever settle this, which is the bug
        s.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      // Do not await: with a live signal this would resolve in ~10s, which is too slow for a suite.
      // The assertion is about the REQUEST, so one turn of the loop is enough to capture it.
      void readBalances(8453, ADDR);
      await new Promise((r) => setTimeout(r, 50));

      expect(fetchSpy).toHaveBeenCalled();
      expect(signals.length).toBeGreaterThan(0);
      for (const s of signals) {
        expect(s, "viem must attach an abort signal — without one a hang never settles").toBeInstanceOf(AbortSignal);
        expect(s?.aborted, "the signal must still be live, not already spent").toBe(false);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resolves to zero balances when the endpoint fails, rather than rejecting", async () => {
    // The other half of the promise: once the bound fires, the failure is absorbed per-read.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("aborted");
      }),
    );
    try {
      const result = await readBalances(8453, ADDR);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((b) => b.base === 0n)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
