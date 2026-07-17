import { describe, expect, test, vi } from "vitest";
import { createSubRegistrarRegister } from "../../src/sns/sub-registrar.js";

const OWNER = "36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4";
const REGISTRAR = "So11111111111111111111111111111111111111112";

// Mock only the Bonfida sub-register binding; real @solana/web3.js PublicKey/Connection are used.
// vi.hoisted lets the mock factory (hoisted to top) share the spy with the test body.
const { registerMock } = vi.hoisted(() => {
  const fakePk = (s: string) => ({ toBase58: () => s });
  return {
    registerMock: vi.fn(async (_conn: unknown, _reg: unknown, buyer: { toBase58(): string }) => [
      {
        programId: fakePk("So11111111111111111111111111111111111111112"),
        keys: [{ pubkey: buyer, isSigner: true, isWritable: true }],
        data: Buffer.from([1, 2, 3]),
      },
    ]),
  };
});
vi.mock("@bonfida/sub-register", () => ({ register: registerMock }));

describe("createSubRegistrarRegister", () => {
  test("wires the user as buyer and returns a neutral v1-shaped instruction", async () => {
    const buildRegister = createSubRegistrarRegister({ rpcUrl: "https://api.devnet.solana.com" });
    const out = await buildRegister({ registrar: REGISTRAR, parent: "qudi.sol", label: "alice", owner: OWNER, rpc: {} });
    // The user's address is passed as the `buyer` (3rd) arg — the permissionless self-register signer.
    expect(registerMock.mock.calls[0][2].toBase58()).toBe(OWNER);
    expect(out.length).toBe(1);
    expect(out[0].programId).toBe(REGISTRAR);
    expect(out[0].keys[0]).toEqual({ pubkey: OWNER, isSigner: true, isWritable: true });
    expect(out[0].data).toEqual(new Uint8Array([1, 2, 3]));
  });
});
