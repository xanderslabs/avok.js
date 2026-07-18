import { describe, it, expect, afterEach, vi } from "vitest";
import { createEvmNamespace } from "../../src/client/evm.js";
import type { Connection } from "../../src/types.js";
import { makeFakeRpc } from "./fakes.js";

/**
 * THE BROWSER'S `fetch` IS A METHOD, AND IT REQUIRES ITS RECEIVER.
 *
 * `const f = globalThis.fetch; f(url)` calls it with `this === undefined`. Safari rejects that with
 * "Failed to execute 'fetch' on 'Window': Illegal invocation". Chrome is lenient and lets it through —
 * which is exactly why this survived an appmode test on Chrome and only blew up on real Safari
 * hardware, on the SPONSORED rail, because that is the only send path that talks to the paymaster.
 *
 * So the default fetch must be BOUND. This test installs a `fetch` that enforces the receiver the way
 * a browser does; an unbound reference fails it.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A `fetch` that behaves like the browser's: it throws unless `this` is the global object. */
function installStrictFetch(handler: (url: string) => unknown) {
  const strict = function (this: unknown, url: string) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => handler(url) });
  };
  globalThis.fetch = strict as unknown as typeof globalThis.fetch;
}

const CHAIN_10_CONFIG = {
  chains: { 10: { sponsor: "0x3333333333333333333333333333333333333333", supportedTokens: [], bufferBps: 1500, marginBps: 500 } },
};

describe("the default fetch is bound to the global", () => {
  it("a SPONSORED send does not die with 'Illegal invocation'", async () => {
    installStrictFetch(() => CHAIN_10_CONFIG);

    const connection = {
      account: () => ({ evm: { address: "0x1111111111111111111111111111111111111111" }, solana: { address: "1" } }),
      status: () => true,
      signSend: vi.fn(),
      signSponsored: vi.fn(),
    } as unknown as Connection;

    const client = createEvmNamespace({
      connection,
      paymasterUrl: "https://pm.test",
      deps: { rpc: makeFakeRpc({ delegated: false, nonce: 0 }) },
    });

    // We only need to reach the paymaster's /config call — the exact thing that threw on Safari. A
    // later failure is fine and expected (the fake signer returns nothing); "Illegal invocation" is
    // NOT, and is the only thing this asserts on.
    let caught: unknown;
    try {
      await client.send([{ to: "0x2222222222222222222222222222222222222222", value: 0n, data: "0x" }], {
        chainId: 10,
        feeToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      });
    } catch (e) {
      caught = e;
    }
    expect(String(caught ?? "")).not.toMatch(/Illegal invocation/);
  });
});
