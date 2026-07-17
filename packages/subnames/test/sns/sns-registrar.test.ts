import { describe, expect, test } from "vitest";
import { AccountRole } from "@solana/kit";
import { createSnsRegistrar } from "../../src/sns/index.js";

const OWNER = "36Dn3RWhB8x4c83W6ebQ2C2eH9sh5bQX2nMdkP2cWaA4";
const REGISTRAR = "So11111111111111111111111111111111111111112";

function fakeRpc() {
  return {} as never;
}

function svc(buildRegister = async () => ({ programId: REGISTRAR, keys: [{ pubkey: OWNER, isSigner: true, isWritable: true }], data: new Uint8Array([9]) })) {
  return createSnsRegistrar({ parent: "qudi.sol", registrar: REGISTRAR, rpc: fakeRpc(), buildRegister });
}

// #6: the resolution cases that used to live here (resolveForward/resolveReverse/isAvailable)
// moved with the code to @avokjs/helpers (test/sns-resolver.test.ts). The SNS adapter that
// remains here only registers — so the sns-sdk-kit mock those cases needed is gone too.
describe("createSnsRegistrar", () => {
  test("buildMintAsync returns chain:solana with normalized kit instructions", async () => {
    const mint = await svc().buildMintAsync({ label: "alice", owner: OWNER });
    expect(mint.chain).toBe("solana");
    if (mint.chain !== "solana") throw new Error("expected solana");
    expect(mint.instructions.length).toBe(1);
    const ix = mint.instructions[0] as { accounts: { role: AccountRole }[] };
    expect(ix.accounts[0].role).toBe(AccountRole.WRITABLE_SIGNER);
  });

  test("buildMintAsync throws without parent + registrar + buildRegister", async () => {
    // WHY: registration config is required for minting; the old "resolution-only mode" case
    // is now meaningless here — resolution is not this adapter's job any more.
    const s = createSnsRegistrar({ rpc: fakeRpc() });
    await expect(s.buildMintAsync({ label: "alice", owner: OWNER })).rejects.toThrow(/registrar|parent|buildRegister/);
  });
});
