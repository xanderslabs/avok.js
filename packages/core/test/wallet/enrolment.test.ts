import { describe, expect, test } from "vitest";
import { hexToBytes, type Address } from "viem";
import { generateEphemeral, randomNonce, deriveSession } from "../../src/wallet/pairing.js";
import {
  buildAck,
  openAck,
  createPasskeyCredential,
  sealWrap,
  openWrap,
  sealAccessSlot,
} from "../../src/wallet/enrolment.js";
import { decryptKeyBlob } from "../../src/wallet/crypto/blob.js";
import { decryptSlotMeta } from "../../src/wallet/crypto/slot-meta.js";
import { deriveSlotId, decodeUserHandle } from "../../src/wallet/passkey/label.js";
import type { PasskeyAdapter } from "../../src/wallet/passkey/adapter.js";

const EVM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as Address;
const K = { key: hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318") };
const PRF2 = () => new Uint8Array(32).fill(2).buffer;
const CRED = "Y3JlZC1saWZlYm9hdA";

/** The enroller's passkey. It lives under an INDEPENDENT domain here — but the ceremony and the passkey
 *  it produces are identical when the credential is simply on the user's own second device. */
const enrollerPasskey = (captured: { handle?: Uint8Array } = {}) =>
  ({
    async create(_label: string, userHandle: Uint8Array) {
      captured.handle = userHandle;
      return {
        credentialId: CRED,
        prfOutput: PRF2(),
        transports: ["internal"],
        rpId: "independent.example",
        prf: { extension: "prf", saltVersion: "v0" } as const,
        platform: { authenticatorAttachment: "platform" } as const,
      };
    },
    async authenticate() {
      throw new Error("not used");
    },
    async discover() {
      throw new Error("not used");
    },
  }) as unknown as PasskeyAdapter;

/** Both halves of one SAS-confirmed session, exactly as the connection builds them. */
async function session() {
  const b = generateEphemeral();
  const a = generateEphemeral();
  const nonce = randomNonce();
  const bs = await deriveSession({
    myPrivate: b.privateKey,
    myPublic: b.publicKey,
    theirPublic: a.publicKey,
    iAmInitiator: true,
    nonce,
  });
  const as = await deriveSession({
    myPrivate: a.privateKey,
    myPublic: a.publicKey,
    theirPublic: b.publicKey,
    iAmInitiator: false,
    nonce,
  });
  expect(as.sas).toBe(bs.sas); // both sides show the user the same 6 digits
  return { holder: as.key, enroller: bs.key, eph: a, nonce };
}

describe("passkey enrolment (the one ceremony)", () => {
  test("the ACK carries the offer — so the ceremony stays at three codes, not four", async () => {
    // encodeAccessHandle is baked into user.id at credential creation, so the enroller cannot mint
    // its passkey until it knows the wallet and its chain. Folding the offer into the ack is what lets
    // us delete K-transport without charging the user an extra QR hop.
    const { holder, enroller, eph, nonce } = await session();
    const ack = await buildAck(eph, nonce, holder, { evm: EVM, anchorChainId: 10 });
    expect(ack.kind).toBe("ack");
    expect(await openAck(enroller, ack)).toEqual({ evm: EVM, anchorChainId: 10 });
  });

  test("the offer is ciphertext — the wallet address does not ride the QR in the clear", async () => {
    const { holder, eph, nonce } = await session();
    const ack = await buildAck(eph, nonce, holder, { evm: EVM, anchorChainId: 10 });
    expect(JSON.stringify(ack).toLowerCase()).not.toContain(EVM.slice(2, 12).toLowerCase());
  });

  test("createPasskeyCredential mints the credential and derives W — and never asks for K", async () => {
    const captured: { handle?: Uint8Array } = {};
    const slot = await createPasskeyCredential({
      passkey: enrollerPasskey(captured),
      networkName: "independent.example",
      evm: EVM,
      anchorChainId: 10,
    });
    expect(slot.rpId).toBe("independent.example");
    expect(slot.wrappingKey.length).toBe(32);
    // The handle marks it a secondary of THIS wallet on THIS chain — the ordering constraint, enforced.
    expect(decodeUserHandle(captured.handle!)).toEqual({ kind: "secondary", evm: EVM, anchorChain: 10 });
  });

  test("THE PROPERTY: K never appears in the wrap, and the sealed slot still opens with prf2", async () => {
    const { holder, enroller } = await session();
    const slot = await createPasskeyCredential({
      passkey: enrollerPasskey(),
      networkName: "independent.example",
      evm: EVM,
      anchorChainId: 10,
    });
    const wire = await sealWrap(enroller, slot);

    // Nothing the enroller sends contains the wallet key — it does not have it, and cannot.
    expect(JSON.stringify(wire)).not.toContain(Buffer.from(K.key).toString("base64"));

    // openWrap decrypts but withholds — the wrapping key is only released by confirm(true).
    const got = (await openWrap(holder, wire)).confirm(true);
    expect(got.credentialId).toBe(CRED);
    expect(got.rpId).toBe("independent.example");

    // The holder seals K under the received W; the enroller opens it with its own PRF alone.
    const sealed = await sealAccessSlot({ container: K, evm: EVM, ...got });
    expect(sealed.slotId).toBe(deriveSlotId(EVM, CRED));
    const recovered = await decryptKeyBlob(sealed.blob, PRF2(), EVM, CRED);
    expect(recovered.key).toEqual(K.key);
  });

  test("the sealed slot carries metadata naming the ENROLLING domain (the roster, for free)", async () => {
    const slot = await createPasskeyCredential({
      passkey: enrollerPasskey(),
      networkName: "independent.example",
      evm: EVM,
      anchorChainId: 10,
    });
    const sealed = await sealAccessSlot({ container: K, evm: EVM, ...slot });
    expect(await decryptSlotMeta(K.key, sealed.slotId, sealed.encryptedMeta)).toEqual({ rpId: "independent.example" });
  });

  test("W is wiped once the blob is sealed — it is as secret as K", async () => {
    const slot = await createPasskeyCredential({
      passkey: enrollerPasskey(),
      networkName: "independent.example",
      evm: EVM,
      anchorChainId: 10,
    });
    await sealAccessSlot({ container: K, evm: EVM, ...slot });
    expect(slot.wrappingKey).toEqual(new Uint8Array(32));
  });

  test("a wrap sealed to one session cannot be opened by another — the channel is the only path", async () => {
    const s1 = await session();
    const s2 = await session();
    const slot = await createPasskeyCredential({
      passkey: enrollerPasskey(),
      networkName: "independent.example",
      evm: EVM,
      anchorChainId: 10,
    });
    const wire = await sealWrap(s1.enroller, slot);
    await expect(openWrap(s2.holder, wire)).rejects.toThrow();
  });

  test("an ack cannot be replayed as a wrap (the payload kind is the AES-GCM additionalData)", async () => {
    const { holder, enroller, eph, nonce } = await session();
    const ack = await buildAck(eph, nonce, holder, { evm: EVM, anchorChainId: 10 });
    await expect(openWrap(enroller, { ...ack, kind: "wrap" } as never)).rejects.toThrow();
  });
});

/**
 * The confirm gate on `openWrap`.
 *
 * Decryption proves the sender held the session key. It does NOT prove that key was negotiated with
 * the intended peer — a MITM has a valid session of its own, and its wrap decrypts perfectly. Sealing
 * K under that wrapping key hands the attacker a passkey into the wallet, so the gate is what stands
 * between "we decrypted something" and "we will seal our key under it".
 *
 * MUTATION: make `confirm` ignore its argument (`if (false)` on the sasConfirmed check) and the
 * refusal tests below must fail. Verified when written.
 */
describe("openWrap is confirm-gated", () => {
  async function wireUp() {
    const { enroller, holder } = await session();
    const wire = await sealWrap(enroller, {
      credentialId: CRED,
      rpId: "independent.example",
      wrappingKey: new Uint8Array(32).fill(7),
    });
    return await openWrap(holder, wire);
  }

  test("REFUSES to release the wrapping key without an explicit true", async () => {
    const pending = await wireUp();
    expect(() => pending.confirm(false)).toThrow(/sasConfirmed/);
  });

  test("refuses truthy-but-not-true values — no accidental coercion past the interlock", async () => {
    // A caller threading a user's answer through an untyped layer can easily produce "true" or 1.
    // The interlock is the last thing before K is sealed under a stranger's key; it takes true only.
    for (const value of ["true", 1, {}, [], "yes"] as unknown as boolean[]) {
      const pending = await wireUp();
      expect(() => pending.confirm(value)).toThrow(/sasConfirmed/);
    }
  });

  test("WIPES the wrapping key on refusal, so a rejected ceremony leaves nothing behind", async () => {
    // The caller still holds a reference to the handle after refusing. A MITM's wrapping key must not
    // be sitting inside it, recoverable by a later confirm(true).
    const pending = await wireUp();
    expect(() => pending.confirm(false)).toThrow();
    expect(() => pending.confirm(true)).toThrow(/already consumed/);
  });

  test("is single use — the same wrapping key cannot be sealed twice", async () => {
    const pending = await wireUp();
    const first = pending.confirm(true);
    expect(first.credentialId).toBe(CRED);
    expect(() => pending.confirm(true)).toThrow(/already consumed/);
  });
});
