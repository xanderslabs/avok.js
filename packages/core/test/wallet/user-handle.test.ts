import { describe, it, expect } from "vitest";
import { hexToBytes } from "viem";
import {
  encodeFoundingHandle,
  encodeAccessHandle,
  decodeUserHandle,
  handleLabel,
} from "../../src/wallet/passkey/label.js";

// EIP-55 checksummed (mixed-case hex letters) so tests can prove checksumming actually happens.
// Derived from viem: getAddress("0xdeadbeef1234567890abcdef1234567890abcdef").
const EVM = "0xdeADbEEf1234567890AbCdeF1234567890ABCdEF" as const;

describe("user handle", () => {
  it("a primary handle is 33 bytes and decodes as primary", () => {
    const h = encodeFoundingHandle();
    expect(h.length).toBe(33);
    expect(h[0]).toBe(0x01);
    expect(decodeUserHandle(h)).toEqual({ kind: "primary" });
  });

  it("two primary handles differ — a constant handle would let one wallet overwrite another", () => {
    // WebAuthn keys a discoverable credential by (rpId, user.id). Same pair ⇒ the authenticator
    // OVERWRITES. A fixed primary handle would silently destroy the user's previous wallet the
    // moment they created a second one on the same provider.
    expect(encodeFoundingHandle()).not.toEqual(encodeFoundingHandle());
  });

  it("a secondary handle is 29 bytes and round-trips the EVM + anchor chain, EIP-55 checksummed", () => {
    // Feed the LOWERCASE EVM in; decode must return the mixed-case checksummed EVM. Because EVM
    // has hex letters whose case must flip, this fails if decode merely echoes the input's case
    // instead of running getAddress() — i.e. the checksum assertion is not vacuous.
    const h = encodeAccessHandle(EVM.toLowerCase() as typeof EVM, 8453);
    expect(h.length).toBe(29);
    expect(h[0]).toBe(0x02);
    expect(decodeUserHandle(h)).toEqual({ kind: "secondary", evm: EVM, anchorChain: 8453 });
  });

  it("round-trips the anchor chainId — the marker that locates the access-slot blob travels with the credential", () => {
    // The whole point of the marker: a secondary's blob lives on the chain that ENROLLED it, and that
    // chain id is recorded in the handle so a DIFFERENT app (same rpId, different app anchor) reads
    // the right chain. 8453 = Base.
    const decoded = decodeUserHandle(encodeAccessHandle(EVM, 8453));
    expect(decoded).toMatchObject({ kind: "secondary", anchorChain: 8453 });
  });

  it("survives a large chainId through the 8-byte big-endian field (arc-testnet 5042002)", () => {
    // 5042002 needs more than 3 bytes; proves the 8-byte width isn't silently truncating.
    const decoded = decodeUserHandle(encodeAccessHandle(EVM, 5042002));
    expect(decoded).toEqual({ kind: "secondary", evm: EVM, anchorChain: 5042002 });
  });

  it("rejects a handle with an unknown kind byte", () => {
    const h = encodeFoundingHandle();
    h[0] = 0x09;
    expect(() => decodeUserHandle(h)).toThrow(/unknown/i);
  });

  it("rejects a truncated handle rather than guessing", () => {
    expect(() => decodeUserHandle(encodeAccessHandle(EVM, 10).slice(0, 20))).toThrow();
  });

  it("rejects a 61-byte legacy secondary handle (the old [evm][32 solana][8 anchor] shape)", () => {
    // The slim dropped the dead 32-byte Solana field: a secondary is now 29 bytes, not 61. An old
    // 61-byte handle must fail the length check outright rather than mis-parse — nothing is launched,
    // so there is no migration path and a stray legacy handle is an error, not a wallet.
    const legacy = new Uint8Array(61);
    legacy[0] = 0x02;
    expect(() => decodeUserHandle(legacy)).toThrow(/29 bytes/);
  });

  it("places EVM at offset 1 and anchor chainId at offset 21 (independent of decode)", () => {
    // Pins the raw secondary byte layout without trusting decodeUserHandle: kind byte at 0,
    // 20-byte EVM at 1, 8-byte big-endian anchor chainId at 21. No Solana bytes anymore.
    const bytes = encodeAccessHandle(EVM, 8453);
    expect(bytes.length).toBe(29);
    expect(bytes[0]).toBe(0x02);
    expect(bytes.slice(1, 21)).toEqual(hexToBytes(EVM));
    // 8453 = 0x2105 big-endian in the trailing 8 bytes.
    expect(bytes.slice(21, 29)).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0x21, 0x05]));
  });

  it("labels a primary without knowing its address", () => {
    // The whole point: at create() we have no address, so the picker label cannot contain one.
    const label = handleLabel("Avok", encodeFoundingHandle());
    expect(label).toMatch(/^Avok Wallet · \w+ \w+$/);
  });

  it("labels a secondary from its handle bytes — a nickname, never the embedded address", () => {
    // Secondaries now share the primary nickname style (handleLabel), so the passkey label never
    // leaks the EVM address to the provider. The label is derived from the handle bytes only.
    const handle = encodeAccessHandle(EVM, 8453);
    const label = handleLabel("Avok", handle);
    expect(label).toMatch(/^\S.* Wallet · \w+ \w+$/);
    // No hex address fragment anywhere in the label.
    expect(label.toLowerCase()).not.toContain(EVM.slice(2, 10).toLowerCase());
    expect(label).not.toMatch(/0x[0-9a-fA-F]{6,}/);
  });

  it("gives a stable label for the same handle", () => {
    const h = encodeFoundingHandle();
    expect(handleLabel("Avok", h)).toBe(handleLabel("Avok", h));
  });
});
