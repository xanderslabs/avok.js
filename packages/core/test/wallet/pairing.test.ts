import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { hexToBytes, type Address } from "viem";
import {
  generateEphemeral,
  randomNonce,
  buildInvite,
  encodePayload,
  decodePayload,
  deriveSession,
  type PairInvite,
} from "../../src/wallet/pairing.js";
import { sealWrap, openWrap } from "../../src/wallet/enrolment.js";

const EVM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as Address;
const KEY = hexToBytes("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

function atobBytes(b64url: string): number[] {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Array.from(Buffer.from(b64, "base64"));
}

const OFFER = { evm: EVM as string, anchorChainId: 10 };

/** Run the holder (A, who now speaks first) and the enroller (B) in one process — headless. */
async function handshake(theirPubToB?: Uint8Array) {
  // ROUND 1: the holder invites, carrying the offer in cleartext.
  const ephA = generateEphemeral();
  const nonce = randomNonce();
  const invite = decodePayload<PairInvite>(encodePayload(buildInvite(ephA, nonce, OFFER)), "invite");

  // ROUND 2: the enroller answers. `theirPubToB` lets a test tamper with A's pubkey as B sees it —
  // the substitution the SAS exists to catch.
  const ephB = generateEphemeral();
  const aPubSeenByB = theirPubToB ?? Uint8Array.from(atobBytes(invite.aPub));
  const b = await deriveSession({
    myPrivate: ephB.privateKey,
    myPublic: ephB.publicKey,
    theirPublic: aPubSeenByB,
    iAmEnroller: true,
    nonce,
    offer: OFFER,
  });

  const a = await deriveSession({
    myPrivate: ephA.privateKey,
    myPublic: ephA.publicKey,
    theirPublic: ephB.publicKey,
    iAmEnroller: false,
    nonce,
    offer: OFFER,
  });
  return { a, b, invite, ephA, ephB, nonce };
}

describe("the provisioning channel", () => {
  test("both sides derive the same session key + SAS, and the invite carries the offer in the clear", async () => {
    const { a, b, invite } = await handshake();
    expect(a.sas).toBe(b.sas);
    expect({ evm: invite.evm, anchorChainId: invite.anchorChainId }).toEqual(OFFER);
  });

  test("a tampered A pubkey (as seen by B) yields a mismatched SAS", async () => {
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
      bPub: s1.ephB.publicKey,
      credentialId: "Y3JlZC1h",
      rpId: "independent.example",
      wrappingKey: new Uint8Array(32).fill(3),
    });
    await expect(openWrap(s2.a.key, wrap)).rejects.toBeDefined();
  });

  test("decodePayload rejects a wrong kind or version", () => {
    const enc = encodePayload(buildInvite(generateEphemeral(), randomNonce(), OFFER));
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
    for (const forbidden of [
      "sealContainer",
      "unsealContainer",
      "PairGrant",
      "SecretContainer",
      "serializeContainer",
    ]) {
      expect(src, `pairing.ts must not reference ${forbidden} — the channel never carries K`).not.toContain(forbidden);
    }
  });

  test("the wallet key is not exported from the package's pairing surface", async () => {
    const mod = (await import("../../src/wallet/index.js")) as Record<string, unknown>;
    expect(mod.sealContainer).toBeUndefined();
    expect(mod.unsealContainer).toBeUndefined();
  });

  test("no payload the enroller receives can carry K, because the holder never sends one", async () => {
    // The holder's ONLY outbound payload is now the invite, and every field of it is public: an
    // ephemeral pubkey, a nonce, an address, a chain id. There is nowhere for a key to hide — and
    // unlike the old sealed ack, that is verifiable by reading the wire directly.
    const { invite } = await handshake();
    expect(Object.keys(invite).sort()).toEqual(["aPub", "anchorChainId", "evm", "kind", "nonce", "v"]);
    expect(JSON.stringify(invite)).not.toContain(Buffer.from(KEY).toString("base64"));
  });
});
