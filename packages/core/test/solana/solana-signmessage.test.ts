import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { encodeOffchainMessage } from "../../src/solana/index.js";
import type { Connection } from "../../src/types.js";
import { createSolanaNamespace } from "../../src/client/solana.js";
import { createOwnOriginConnection } from "../../src/own-origin/connection.js";
import { makeFakePasskey } from "../client/fakes.js";

const USER_ADDR = "11111111111111111111111111111111";

/** Minimal Connection double with signSolanaMessage. */
function fakeSolanaConnection(): Connection {
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
      solana: { address: USER_ADDR },
    }),
    status: () => true,
    async signSolanaMessage(message: string) {
      return { signature: "1111111111111111111111111111111111111111111111111111111111111111111111111111111111111" };
    },
    // Stub out other methods
    async signMessage() { throw new Error("not implemented"); },
    async signTypedData() { throw new Error("not implemented"); },
    async signSiwe() { throw new Error("not implemented"); },
    async signAuthorization() { throw new Error("not implemented"); },
    async signTransaction() { throw new Error("not implemented"); },
    async signSolanaTransaction() { throw new Error("not implemented"); },
    async create() { throw new Error("not implemented"); },
    async continue() { throw new Error("not implemented"); },
    async export() { throw new Error("not implemented"); },
    async logout() {},
    async addPasskey() { throw new Error("not implemented"); },
    canExport: false,
  } as unknown as Connection;
}

describe("client.signMessage", () => {
  it("signMessage delegates to the connection (base58 signature)", async () => {
    const client = createSolanaNamespace({ connection: fakeSolanaConnection() });
    const { signature } = await client.signMessage("gm");
    expect(typeof signature).toBe("string");
  });
});

describe("own-origin signSolanaMessage byte-identity with encodeOffchainMessage", () => {
  it("signs the full v0 envelope for opts.rpId", async () => {
    const passkey = makeFakePasskey();
    const conn = createOwnOriginConnection({ rpId: "avok.test", passkey });
    const { solana } = await conn.create();
    const { signature } = await conn.signSolanaMessage("gm");
    const sigBytes = base58.decode(signature);
    const pubkeyBytes = base58.decode(solana.address);
    expect(ed25519.verify(sigBytes, encodeOffchainMessage({ message: "gm", rpId: "avok.test" }), pubkeyBytes)).toBe(true);
  });
});
