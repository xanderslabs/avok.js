import { describe, expect, test } from "vitest";
import { keccak256, type Address } from "viem";
import { deriveSlotId } from "./passkey/label.js";
import { base64UrlToBytes } from "./encoding.js";

const ADDR_A = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" as Address;
const ADDR_B = "0x000000000000000000000000000000000000dEaD" as Address;
const CRED = "Y3JlZC1hYWE";

describe("deriveSlotId", () => {
  test("is stable per (address, credential) and 32 bytes", () => {
    const a = deriveSlotId(ADDR_A, CRED);
    expect(a).toBe(deriveSlotId(ADDR_A, CRED));
    expect(a).toHaveLength(66); // 0x + 64 hex chars
  });

  test("separates credentials within one wallet", () => {
    expect(deriveSlotId(ADDR_A, "Y3JlZC1hYWE")).not.toBe(deriveSlotId(ADDR_A, "Y3JlZC1iYmI"));
  });

  /**
   * THE PRIVACY PROPERTY. The credential id is sent to a relying party on every assertion, so every
   * RP a user has logged into holds it. If the slot id were keccak256(credentialId) alone, any such
   * RP could compute it and filter AccessSlotAdded logs to find the user's wallet. Binding the
   * address means the slot id cannot be computed without already knowing the address.
   */
  test("the SAME credential yields a DIFFERENT slot id under a different wallet", () => {
    expect(deriveSlotId(ADDR_A, CRED)).not.toBe(deriveSlotId(ADDR_B, CRED));
  });

  test("is not computable from the credential id alone (address is bound in)", () => {
    // The old, broken derivation. If deriveSlotId ever equals this again, the
    // RP-can-find-your-wallet hole is back.
    const credentialIdOnly = keccak256(base64UrlToBytes(CRED));
    expect(deriveSlotId(ADDR_A, CRED)).not.toBe(credentialIdOnly);
  });

  test("is case-insensitive in the address (checksummed or not, same slot)", () => {
    // A caller that passes a lowercased address must not land on a different slot than one that
    // passes the checksummed form, or a wallet would silently fail to find its own blob.
    expect(deriveSlotId(ADDR_A.toLowerCase() as Address, CRED)).toBe(deriveSlotId(ADDR_A, CRED));
  });
});
