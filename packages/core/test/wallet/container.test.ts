import { describe, it, expect } from "vitest";
import { hexToBytes } from "viem";
import * as container from "../../src/wallet/crypto/container.js";
import * as derive from "../../src/wallet/crypto/derive.js";
import { produceEvmKey, assertContainerComplete } from "../../src/wallet/crypto/container.js";
import { deriveWalletKey } from "../../src/wallet/crypto/derive-wallet.js";

const KEY = hexToBytes(`0x${"ab".repeat(32)}`);

describe("SecretContainer", () => {
  it("the EVM key is the container key itself (same bytes)", () => {
    // K IS the EVM private key — the exact same 32 mutable bytes, by reference.
    expect(produceEvmKey({ key: KEY })).toBe(KEY);
  });

  it("rejects a container with no key rather than silently producing a wallet", () => {
    expect(() => assertContainerComplete({} as never)).toThrow();
    expect(() => assertContainerComplete({ key: new Uint8Array(0) } as never)).toThrow();
  });

  // GUARD. K is the EVM key now. A second curve from the same container is how the rail creeps back.
  it("produces no Solana key", () => {
    expect(container).not.toHaveProperty("produceSolanaKey");
    expect(derive).not.toHaveProperty("solanaAddressFromSecret");
    expect(derive).not.toHaveProperty("deriveSolanaKey");
  });

  it("still derives a stable EVM address from a PRF output", async () => {
    const key = await deriveWalletKey(new Uint8Array(32).fill(7).buffer);
    expect(derive.evmAddress(container.produceEvmKey({ key }))).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("derives the same address twice from the same PRF, which makes the wallet reachable", async () => {
    const a = await deriveWalletKey(new Uint8Array(32).fill(9).buffer);
    const b = await deriveWalletKey(new Uint8Array(32).fill(9).buffer);
    expect(derive.evmAddress(container.produceEvmKey({ key: a }))).toBe(
      derive.evmAddress(container.produceEvmKey({ key: b })),
    );
  });
});
