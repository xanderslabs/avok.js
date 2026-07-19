import { describe, it, expect, vi } from "vitest";
import { toRemoteKitSigner } from "./signer.js";

describe("toRemoteKitSigner", () => {
  it("calls sign(tx.messageBytes) and returns a SignatureDictionary keyed by address", async () => {
    const sig = new Uint8Array(64).fill(3);
    const sign = vi.fn().mockResolvedValue(sig);
    const address = "So1anaAddr1111111111111111111111111111111" as never;
    const signer = toRemoteKitSigner({ address, sign });

    const messageBytes = new Uint8Array([1, 2, 3]);
    const [dict] = await signer.signTransactions([{ messageBytes } as never]);

    expect(sign).toHaveBeenCalledWith(messageBytes);
    expect(dict[address]).toBe(sig);
    expect(signer.address).toBe(address);
  });

  it("signs each tx's own message bytes for a batch", async () => {
    const sign = vi.fn(async (b: Uint8Array) => new Uint8Array([b[0]!]));
    const address = "So1anaAddr1111111111111111111111111111111" as never;
    const signer = toRemoteKitSigner({ address, sign });
    const out = await signer.signTransactions([
      { messageBytes: new Uint8Array([5]) } as never,
      { messageBytes: new Uint8Array([6]) } as never,
    ]);
    expect(out[0]![address]).toEqual(new Uint8Array([5]));
    expect(out[1]![address]).toEqual(new Uint8Array([6]));
  });
});
