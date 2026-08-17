/**
 * PURE SPONSORSHIP — the paymaster pays, the user repays NOTHING.
 *
 * `{ sponsored: true }` with no `feeToken` reaches the sponsored rail. This is the stock ERC-7677
 * verifying paymaster (Pimlico, Alchemy, Coinbase): it pays the gas and charges the user no token.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 *
 * Rail selection used to read `ctx.feeToken ? "sponsored" : "native-gas"`, so a fee token was the ONLY
 * door to the sponsored rail. Two consequences, both fatal to what sponsorship is for:
 *
 *   1. The onboarding user — the one the rail exists to serve — holds no gas AND no fee token. There
 *      was no way to sponsor their first transaction, which is precisely the transaction that has to
 *      be sponsored for them to have anything at all.
 *   2. A chain whose registry lists no fee tokens could not be sponsored on at any price. Ethereum
 *      Sepolia lists none, so the sponsored rail was unreachable on the only EVM testnet in the
 *      registry — the rail could not even be demonstrated.
 *
 * Lower layers already tolerated it: `leanResolve` writes `feeToken: ctx.feeToken ?? null` on a
 * sponsored batch, `prepareSponsoredUserOp` omits the ERC-7677 `context` when the token is null, and
 * `simulate` discloses no fee amount rather than inventing one. Only rail SELECTION disagreed.
 *
 * "Who pays" and "in what" are separate questions. A fee token implies sponsorship; sponsorship does
 * not imply a fee token.
 *
 * ── MUTATION EVIDENCE (run when written) ─────────────────────────────────────────────────────────
 *
 * Revert railFromContext to `ctx.feeToken ? "sponsored" : "native-gas"` and the rail/handshake tests
 * below fail — the sends silently take the native-gas rail and the paymaster is never dialled.
 */
import { describe, it, expect, vi } from "vitest";
import type { Address, Hex } from "viem";
import { createEvmNamespace } from "../../src/client/evm.js";
import { SponsorshipUnavailableError } from "../../src/client/sponsorship-error.js";
import { getChainProfile } from "../../src/evm/index.js";
import type { Connection } from "../../src/types.js";
import { makeFakeRpc } from "../client/fakes.js";

const CHAIN = getChainProfile(10)!;
const NON_ZERO_IMPL = "0x1234567890123456789012345678901234567890" as const satisfies Address;
const TEST_CHAIN = { ...CHAIN, canonicalImplementation: NON_ZERO_IMPL };
const CALLS = [{ to: "0x2222222222222222222222222222222222222222" as Address, value: 0n, data: "0x" as const }];

function makeFakeConnection(): Connection {
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
    }),
    status: () => true,
    signTypedData: vi.fn(async () => "0xsig" as Hex),
    signAuthorization: vi.fn(async (a: object) => ({ ...a, r: "0xr" as Hex, s: "0xs" as Hex, yParity: 0 })),
    signSend: vi.fn(async () => "0xserialized" as Hex),
    signUserOp: vi.fn(async () => ({ signature: "0xu5e40p" as Hex })),
  } as unknown as Connection;
}

const PM = "0x4444444444444444444444444444444444444444" as const satisfies Address;

/** What the SDK hands an ERC-7677 paymaster. Only `context` is asserted on — the 4th standard param,
 *  which carries the repayment token and must be ABSENT under pure sponsorship. */
type StubParams = { context?: unknown };

/** ERC-7677 paymaster double: answers both handshake legs and records what it was asked. */
function makeFakePaymaster() {
  return {
    getPaymasterStubData: vi.fn(async (_params: StubParams) => ({
      paymaster: PM,
      paymasterData: "0xstub" as Hex,
      paymasterVerificationGasLimit: 20_000n,
      paymasterPostOpGasLimit: 10_000n,
    })),
    getPaymasterData: vi.fn(async (_params: StubParams) => ({ paymaster: PM, paymasterData: "0xfinal" as Hex })),
  };
}

/** Bundler double: estimates gas and echoes a userOpHash on submit. */
function makeFakeBundler() {
  return {
    estimateUserOperationGas: vi.fn(async () => ({
      callGasLimit: 100_000n,
      verificationGasLimit: 120_000n,
      preVerificationGas: 50_000n,
      paymasterVerificationGasLimit: 20_000n,
      paymasterPostOpGasLimit: 10_000n,
    })),
    sendUserOperation: vi.fn(async (_op: unknown) => "0xuserophash" as Hex),
    getUserOperationReceipt: vi.fn(async () => null),
  };
}

function withInfra() {
  const bundler = makeFakeBundler();
  const paymaster = makeFakePaymaster();
  const evm = createEvmNamespace({
    connection: makeFakeConnection(),
    paymasterUrl: "https://pm.test",
    bundlerUrl: "https://bundler.test",
    deps: { rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN, bundler, paymaster },
  } as never);
  return { evm, bundler, paymaster };
}

describe("pure sponsorship — sponsored with no fee token", () => {
  it("takes the SPONSORED rail with no feeToken at all", async () => {
    const { evm, bundler } = withInfra();
    const receipt = await evm.send(CALLS, { chainId: 10, sponsored: true });

    expect(receipt.rail).toBe("sponsored");
    expect(bundler.sendUserOperation).toHaveBeenCalledOnce();
  });

  it("runs the full ERC-7677 handshake — the paymaster really is asked to sponsor", async () => {
    // Rail label alone would pass even if the paymaster were never dialled. This pins the wire calls
    // that make it a sponsored transaction rather than a native-gas one wearing the wrong name.
    const { evm, paymaster } = withInfra();
    await evm.send(CALLS, { chainId: 10, sponsored: true });

    expect(paymaster.getPaymasterStubData).toHaveBeenCalledOnce();
    expect(paymaster.getPaymasterData).toHaveBeenCalledOnce();
  });

  it("sends NO ERC-7677 `context` — there is no token to name", async () => {
    // The 4th ERC-7677 param carries the repayment token. With nothing being repaid, sending a context
    // would be describing a charge that does not exist, and paymasters reject unknown context shapes.
    const { evm, paymaster } = withInfra();
    await evm.send(CALLS, { chainId: 10, sponsored: true });

    expect(paymaster.getPaymasterStubData.mock.calls[0]![0].context).toBeUndefined();
    expect(paymaster.getPaymasterData.mock.calls[0]![0].context).toBeUndefined();
  });

  it("discloses NO fee amount — nothing is charged, so any number would be a lie", async () => {
    // simulate() feeds the consent screen. Native-gas shows an estimate and a token-repaid sponsored send
    // shows a bounded amount; pure sponsorship shows neither, because the user pays nothing.
    const { evm } = withInfra();
    const sim = await evm.simulate(CALLS, { chainId: 10, sponsored: true });

    expect(sim.batch.rail).toBe("sponsored");
    expect(sim.fee).toBeUndefined();
  });

  it("still fails loud with no rail configured — asking this way is a request like any other", async () => {
    // `sponsored` alone is a sponsorship request, so it gets the same treatment as a fee token: no rail
    // means an error, not a quiet native-gas.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      deps: { rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN },
    } as never);

    await expect(evm.send(CALLS, { chainId: 10, sponsored: true })).rejects.toBeInstanceOf(SponsorshipUnavailableError);
  });

  it("omitting `sponsored` entirely is still native-gas — sponsorship is never inferred", async () => {
    // The BYO invariant seen from this side: infra being CONFIGURED must not make every send sponsored.
    // A developer with a paymaster wired up still chooses per send who pays.
    const { evm, bundler } = withInfra();
    const receipt = await evm.send(CALLS, { chainId: 10 });

    expect(receipt.rail).toBe("native-gas");
    expect(bundler.sendUserOperation).not.toHaveBeenCalled();
  });
});
