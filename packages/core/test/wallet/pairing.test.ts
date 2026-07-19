import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { hexToBytes, type Address } from "viem";
import {
  generateEphemeral,
  randomNonce,
  buildRequest,
  encodePayload,
  decodePayload,
  deriveSession,
  type PairRequest,
  type PairAck,
} from "../../src/wallet/pairing.js";
import { buildAck, openAck, sealWrap, openWrap } from "../../src/wallet/enrolment.js";

const EVM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as Address;
const KEY = hexToBytes("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

function atobBytes(b64url: string): number[] {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Array.from(Buffer.from(b64, "base64"));
}

/** Run the holder (A, responder) and the enroller (B, initiator) in one process — headless. */
async function handshake(theirPubToA?: Uint8Array) {
  const ephB = generateEphemeral(); // the enroller initiates
  const nonce = randomNonce();
  const req = decodePayload<PairRequest>(encodePayload(buildRequest(ephB, nonce)), "request");

  const ephA = generateEphemeral(); // the holder responds
  const bPubSeenByA = theirPubToA ?? Uint8Array.from(atobBytes(req.bPub)); // allow tampering B's pub as A sees it
  const a = await deriveSession({
    myPrivate: ephA.privateKey,
    myPublic: ephA.publicKey,
    theirPublic: bPubSeenByA,
    iAmInitiator: false,
    nonce,
  });
  const ackPayload = await buildAck(ephA, nonce, a.key, { evm: EVM, anchorChainId: 10 });
  const ack = decodePayload<PairAck>(encodePayload(ackPayload), "ack");

  const b = await deriveSession({
    myPrivate: ephB.privateKey,
    myPublic: ephB.publicKey,
    theirPublic: Uint8Array.from(atobBytes(ack.aPub)),
    iAmInitiator: true,
    nonce,
  });
  return { a, b, ack, ephA, ephB, nonce };
}

describe("the provisioning channel", () => {
  test("both sides derive the same session key + SAS, and the offer round-trips inside the ack", async () => {
    const { a, b, ack } = await handshake();
    expect(a.sas).toBe(b.sas);
    expect(await openAck(b.key, ack)).toEqual({ evm: EVM, anchorChainId: 10 });
  });

  test("a tampered B pubkey (as seen by A) yields a mismatched SAS", async () => {
    // The MITM defence, unchanged by the collapse. What it now protects is the WRAP: an attacker who
    // substituted its own wrapping key would get A to seal K under it — a passkey into the wallet.
    const evil = generateEphemeral();
    const { a, b } = await handshake(evil.publicKey);
    expect(a.sas).not.toBe(b.sas);
  });

  test("a wrap sealed to one session will not open under another", async () => {
    const s1 = await handshake();
    const s2 = await handshake();
    const wrap = await sealWrap(s1.b.key, {
      credentialId: "Y3JlZC1h",
      rpId: "independent.example",
      wrappingKey: new Uint8Array(32).fill(3),
    });
    await expect(openWrap(s2.a.key, wrap)).rejects.toBeDefined();
  });

  test("decodePayload rejects a wrong kind or version", () => {
    const enc = encodePayload(buildRequest(generateEphemeral(), randomNonce()));
    expect(() => decodePayload(enc, "ack")).toThrow(/pairing payload/i);
  });
});

/**
 * THE GUARD THAT KEEPS K OFF THE WIRE.
 *
 * There used to be a second ceremony that shipped the wallet key itself to the new device
 * (sealContainer / unsealContainer / PairGrant). It is deleted: the enrolling side derives its own
 * wrapping key and sends THAT, so K never travels at all. This test fails if anyone reintroduces
 * key-transport on this channel — which would be a silent, total regression of the property.
 */
describe("K-transport is gone, and must stay gone", () => {
  test("pairing.ts holds no container/key-sealing API", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/wallet/pairing.ts"), "utf8");
    for (const forbidden of ["sealContainer", "unsealContainer", "PairGrant", "SecretContainer", "serializeContainer"]) {
      expect(src, `pairing.ts must not reference ${forbidden} — the channel never carries K`).not.toContain(forbidden);
    }
  });

  test("the wallet key is not exported from the package's pairing surface", async () => {
    const mod = (await import("../../src/wallet/index.js")) as Record<string, unknown>;
    expect(mod.sealContainer).toBeUndefined();
    expect(mod.unsealContainer).toBeUndefined();
  });

  test("no payload the enroller receives can carry K, because the holder never sends one", async () => {
    // The holder's ONLY outbound payload is the ack, and its sealed body is the offer: a public address
    // and a chain id. There is nowhere for a key to hide.
    const { b, ack } = await handshake();
    const offer = await openAck(b.key, ack);
    expect(Object.keys(offer).sort()).toEqual(["anchorChainId", "evm"]);
    expect(JSON.stringify(offer)).not.toContain(Buffer.from(KEY).toString("base64"));
  });
});
