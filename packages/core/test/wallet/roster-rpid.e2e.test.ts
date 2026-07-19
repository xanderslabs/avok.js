import { describe, expect, test } from "vitest";
import { hexToBytes, type Address, type Hex } from "viem";
import { addPasskey } from "../../src/wallet/wallet.js";
import { listAccessSlots } from "../../src/wallet/roster.js";
import { readAccessSlotRpId } from "../../src/wallet/roster-meta.js";
import { deriveSlotId } from "../../src/wallet/passkey/label.js";
import type { PasskeyAdapter } from "../../src/wallet/passkey/adapter.js";

/**
 * THE REASON THIS FEATURE EXISTS. A wallet's passkeys may live under several independent domains — the
 * crypto never bound one — and "you permanently trust every domain you have ever signed with" is the
 * wallet's real attack surface. Until now that surface was invisible. Here it is made visible: two
 * passkeys enrolled by two different origins, and the roster names both domains, decrypting only under K.
 */
const KEY = `0x${"cd".repeat(32)}` as const;
const EVM = "0x3333333333333333333333333333333333333333" as Address;
const SOL = "11111111111111111111111111111111";

const fakePasskey = (credentialId: string, rpId: string, prfFill: number) =>
  ({
    async create() {
      return {
        credentialId,
        prfOutput: new Uint8Array(32).fill(prfFill).buffer,
        transports: ["internal"],
        rpId,
        prf: { extension: "prf", saltVersion: "v0" } as const,
        platform: { authenticatorAttachment: "platform" } as const,
      };
    },
    async authenticate() { throw new Error("not used"); },
    async discover() { throw new Error("not used"); },
  }) as unknown as PasskeyAdapter;

describe("the roster names the domains that hold the key", () => {
  test("two passkeys under two independent rp-ids both come back", async () => {
    const vault = new Map<Hex, Uint8Array>(); // the chain: slotId -> metadata ciphertext

    for (const [credentialId, rpId, fill] of [
      ["Y3JlZC1mb28", "foo.example", 1],
      ["Y3JlZC1sYmI", "lifeboat.example", 2],
    ] as const) {
      const r = await addPasskey({
        passkey: fakePasskey(credentialId, rpId, fill),
        networkName: rpId,
        container: { key: hexToBytes(KEY) },
        address: EVM,
        solanaAddress: SOL,
        anchorChainId: 10,
      });
      vault.set(deriveSlotId(EVM, r.slot.credentialId), r.encryptedMeta);
    }

    const accessSlots = await listAccessSlots({
      address: EVM,
      reader: {
        getAccessSlotIds: async () => [...vault.keys()],
        getAccessSlotAddedAt: async () => 1_700_000_000,
        getAccessSlotMeta: async (_a, slotId) => vault.get(slotId) ?? new Uint8Array(0),
      },
    });

    expect(accessSlots).toHaveLength(2);
    const rpIds = await Promise.all(accessSlots.map((d) => readAccessSlotRpId(hexToBytes(KEY), d)));
    expect(rpIds.sort()).toEqual(["foo.example", "lifeboat.example"]);
  });
});
