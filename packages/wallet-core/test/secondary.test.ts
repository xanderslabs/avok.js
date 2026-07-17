import { describe, it, expect } from "vitest";
import { hexToBytes } from "viem";
import { addPasskey } from "../src/wallet.js";
import { decryptKeyBlob } from "../src/crypto/blob.js";
import { decodeUserHandle, deriveSlotId } from "../src/passkey/label.js";
import { decryptSlotMeta } from "../src/crypto/slot-meta.js";
import type { PasskeyAdapter } from "../src/passkey/adapter.js";

const KEY = `0x${"cd".repeat(32)}` as const;
const EVM = "0x3333333333333333333333333333333333333333" as const;
const SOL = "11111111111111111111111111111111";
const PRF_B = new Uint8Array(32).fill(42).buffer;

const fakeSecondary = () => {
  const captured: { handle?: Uint8Array } = {};
  const passkey = {
    async create(_label: string, userHandle: Uint8Array) {
      captured.handle = userHandle;
      return {
        credentialId: "Y3JlZC1i",
        prfOutput: PRF_B,
        transports: ["internal"],
        rpId: "avok.test",
        prf: { extension: "prf", saltVersion: "v0" } as const,
        platform: { authenticatorAttachment: "platform" } as const,
      };
    },
    async authenticate() { return PRF_B; },
    async discover() { throw new Error("not used"); },
  } as unknown as PasskeyAdapter;
  return { passkey, captured };
};

describe("addPasskey (secondary enrolment)", () => {
  it("wraps the EXISTING wallet key under the new credential's PRF", async () => {
    // The invariant that makes Solana work: a secondary must reach the SAME K, because the
    // Solana address IS the ed25519 public key of K. A freshly derived key would be a new wallet.
    const { passkey } = fakeSecondary();
    const { slot, blob } = await addPasskey({
      passkey, networkName: "Avok", container: { key: hexToBytes(KEY) }, address: EVM, solanaAddress: SOL, anchorChainId: 10,
    });
    const recovered = await decryptKeyBlob(blob, PRF_B, EVM, slot.credentialId);
    expect(recovered.key).toEqual(hexToBytes(KEY));
  });

  it("marks the credential as a secondary and records both addresses + anchor chain in its handle", async () => {
    const { passkey, captured } = fakeSecondary();
    await addPasskey({ passkey, networkName: "Avok", container: { key: hexToBytes(KEY) }, address: EVM, solanaAddress: SOL, anchorChainId: 10 });
    expect(decodeUserHandle(captured.handle!)).toEqual({ kind: "secondary", evm: EVM, anchorChain: 10 });
  });

  it("emits access-slot metadata that decrypts to the enrolling rp-id", async () => {
    // This is what makes the trust surface auditable: the access slot records WHICH DOMAIN enrolled it,
    // encrypted under a K-derived key, so only a holder of the wallet key can read the roster.
    const { passkey } = fakeSecondary();
    const container = { key: hexToBytes(KEY) };
    const r = await addPasskey({
      passkey, networkName: "Avok", container, address: EVM, solanaAddress: SOL, anchorChainId: 10,
    });
    const slotId = deriveSlotId(EVM, r.slot.credentialId);
    expect(await decryptSlotMeta(hexToBytes(KEY), slotId, r.encryptedMeta)).toEqual({ rpId: r.slot.rpId });
    expect(r.slot.rpId).toBe("avok.test");
  });
});
