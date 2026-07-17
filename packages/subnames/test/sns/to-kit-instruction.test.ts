import { describe, expect, test } from "vitest";
import { AccountRole } from "@solana/kit";
import { toKitInstruction } from "../../src/sns/to-kit-instruction.js";

const PROG = "Sysvar1nstructions1111111111111111111111111";
const SIGNER = "36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4";
const RO = "So11111111111111111111111111111111111111112";

describe("toKitInstruction", () => {
  test("maps programId/keys/data into a kit Instruction with correct roles", () => {
    const ix = toKitInstruction({
      programId: PROG,
      keys: [
        { pubkey: SIGNER, isSigner: true, isWritable: true },
        { pubkey: RO, isSigner: false, isWritable: false },
      ],
      data: new Uint8Array([1, 2, 3]),
    });
    expect(ix.programAddress).toBe(PROG);
    expect(ix.accounts?.[0]).toEqual({ address: SIGNER, role: AccountRole.WRITABLE_SIGNER });
    expect(ix.accounts?.[1]).toEqual({ address: RO, role: AccountRole.READONLY });
    expect(ix.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("maps readonly-signer and writable-nonsigner roles", () => {
    const ix = toKitInstruction({
      programId: PROG,
      keys: [
        { pubkey: SIGNER, isSigner: true, isWritable: false },
        { pubkey: RO, isSigner: false, isWritable: true },
      ],
      data: new Uint8Array(),
    });
    expect(ix.accounts?.[0]?.role).toBe(AccountRole.READONLY_SIGNER);
    expect(ix.accounts?.[1]?.role).toBe(AccountRole.WRITABLE);
  });
});
