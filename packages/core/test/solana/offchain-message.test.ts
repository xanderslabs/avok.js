import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { encodeOffchainMessage } from "../../src/solana/offchain-message.js";

describe("encodeOffchainMessage (wallet-standard v0)", () => {
  const rpId = "avok.test";
  it("lays out domain ‖ version ‖ sha256(rpId) ‖ format ‖ length ‖ message", () => {
    const out = encodeOffchainMessage({ message: "gm", rpId });
    const td = new TextEncoder();
    expect(out[0]).toBe(0xff);
    expect(new TextDecoder().decode(out.slice(1, 16))).toBe("solana offchain");
    expect(out[16]).toBe(0); // version
    expect(Array.from(out.slice(17, 49))).toEqual(Array.from(sha256(td.encode(rpId)))); // app domain
    expect(out[49]).toBe(0); // ASCII format
    expect(out[50] | (out[51] << 8)).toBe(2); // u16 LE length of "gm"
    expect(new TextDecoder().decode(out.slice(52))).toBe("gm");
  });

  it("uses UTF-8 format (2) for non-ASCII", () => {
    const out = encodeOffchainMessage({ message: "gm☕", rpId });
    expect(out[49]).toBe(2);
  });

  it("is byte-identical for the same rpId+message", () => {
    expect(encodeOffchainMessage({ message: "x", rpId })).toEqual(encodeOffchainMessage({ message: "x", rpId }));
  });
});
