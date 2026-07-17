import { describe, it, expect } from "vitest";
import { hexToBytes } from "viem";
import { produceEvmKey, produceSolanaKey, assertContainerComplete } from "../src/crypto/container.js";

const KEY = hexToBytes(`0x${"ab".repeat(32)}`);

describe("SecretContainer", () => {
  it("the EVM key is the container key itself (same bytes)", () => {
    // K is the EVM private key directly — the exact same 32 mutable bytes, by reference.
    expect(produceEvmKey({ key: KEY })).toBe(KEY);
  });

  it("the Solana key is derived from it — one secret, two chains", () => {
    // Both credentials must reach the SAME K, and therefore the same ed25519 keypair. Solana's
    // address IS that public key, so a second derivation path would be a second wallet.
    expect(produceSolanaKey({ key: KEY })).toEqual(produceSolanaKey({ key: KEY }));
    expect(produceSolanaKey({ key: KEY })).not.toEqual(KEY);
  });

  it("rejects a container with no key rather than silently producing a wallet", () => {
    expect(() => assertContainerComplete({} as never)).toThrow();
    expect(() => assertContainerComplete({ key: new Uint8Array(0) } as never)).toThrow();
  });
});
