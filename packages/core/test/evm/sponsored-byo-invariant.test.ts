/**
 * BRING-YOUR-OWN sponsorship invariant.
 *
 * HARD INVARIANT: the SDK never sponsors a transaction on infrastructure the developer did not
 * supply. It ships no default bundler, no default paymaster and no default Kora endpoint, and it
 * must acquire none — not even one operated by the SDK's own authors. A sponsored send is reachable
 * only through a URL or a client the app passed in.
 *
 * This matters because a default endpoint is not a convenience, it is a silent custody-adjacent
 * dependency: whoever runs the paymaster sees every sponsored transaction before it lands, decides
 * whether to relay it, and is a party the user never agreed to. The rule holds regardless of who
 * would run it, so "we could just default it to ours" is closed by a failing test rather than by
 * remembering.
 *
 * The proof is a PAIR. The same send, with a fee token, is run twice against configs that differ
 * only in whether the developer supplied 4337 infra:
 *   - supplied     -> rail "sponsored", the bundler is dialled
 *   - not supplied -> rail "self-pay",  the bundler is never constructed
 * A hardcoded default would make the second case behave like the first, which is precisely the
 * assertion that then fails. Asserting only the negative case would not do: it passes for any
 * reason the send fails, including reasons that have nothing to do with sponsorship.
 *
 * The self-pay degrade is deliberate (SPEC §1, "self-pay everywhere; sponsored only where a
 * bundler+paymaster exist") — the transaction still goes through, paid natively. It is pinned here
 * because it also means a sponsored REQUEST can be silently self-paid, and `receipt.rail` is the
 * only thing that says which actually happened.
 *
 * MUTATION: give canSponsor() a default endpoint —
 *   return Boolean((paymasterUrl || deps?.paymaster || "https://…") && (bundlerUrl || deps?.bundler || "https://…"))
 * — and the two "WITHOUT infra" tests must fail. Verified when written: 2 of 4 fail, and the 2 that
 * survive are the WITH-infra case and the construction check, which that mutation does not touch.
 *
 * An earlier draft of this file asserted only `rejects.not.toThrow(/unsupported fee token/i)` on a
 * send with no RPC. It passed the mutation above, because the send was already failing upstream for
 * an unrelated reason — a negative assertion on a path that can fail earlier proves nothing. That is
 * why the assertions here are a PAIR on `receipt.rail` rather than a single negative.
 */
import { describe, it, expect, vi, type Mock } from "vitest";
import type { Address, Hex } from "viem";
import { createEvmNamespace } from "../../src/client/evm.js";
import { getChainProfile } from "../../src/evm/index.js";
import type { Connection } from "../../src/types.js";
import { makeFakeRpc } from "../client/fakes.js";

const CHAIN = getChainProfile(10)!;
const FEE_TOKEN = Object.values(CHAIN.tokens)[0]!.address;
const NON_ZERO_IMPL = "0x1234567890123456789012345678901234567890" as const satisfies Address;
const TEST_CHAIN = { ...CHAIN, canonicalImplementation: NON_ZERO_IMPL };
const TO = "0x2222222222222222222222222222222222222222" as const;

function makeFakeConnection(): Connection {
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
      solana: { address: "11111111111111111111111111111111" },
    }),
    status: () => true,
    signTypedData: vi.fn(async () => "0xsig" as Hex),
    signAuthorization: vi.fn(async (a: object) => ({ ...a, r: "0xr" as Hex, s: "0xs" as Hex, yParity: 0 })),
    signTransaction: vi.fn(async () => "0xserialized" as Hex),
    // The self-pay rail signs through `signSend` (one gesture: tx + any 7702 authorization).
    signSend: vi.fn(async () => "0xserialized" as Hex),
    signUserOp: vi.fn(async () => ({ signature: "0xu5e40p" as Hex })),
  } as unknown as Connection;
}

function makeFakeBundler() {
  return {
    estimateUserOperationGas: vi.fn(async () => ({
      preVerificationGas: 1n,
      verificationGasLimit: 1n,
      callGasLimit: 1n,
      paymasterVerificationGasLimit: 1n,
      paymasterPostOpGasLimit: 1n,
    })),
    sendUserOperation: vi.fn(async () => "0xabc123hash" as Hex),
    getUserOperationReceipt: vi.fn(async () => null),
  };
}

function makeFakePaymaster() {
  return {
    getPaymasterStubData: vi.fn(async () => ({ paymaster: TO as Address, paymasterData: "0xstub" as Hex })),
    getPaymasterData: vi.fn(async () => ({ paymaster: TO as Address, paymasterData: "0xfinal" as Hex })),
  };
}

describe("sponsorship is bring-your-own — the SDK supplies no infrastructure", () => {
  it("WITH developer-supplied 4337 infra, a fee-token send takes the sponsored rail", async () => {
    const bundler = makeFakeBundler();
    const paymaster = makeFakePaymaster();
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      paymasterUrl: "https://pm.test",
      bundlerUrl: "https://bundler.test",
      deps: { rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN, bundler, paymaster },
    } as never);

    const receipt = await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN });

    expect(receipt.rail).toBe("sponsored");
    expect(bundler.sendUserOperation).toHaveBeenCalledOnce();
  });

  it("WITHOUT any infra, the SAME send falls to self-pay — no default endpoint exists to sponsor it", async () => {
    // Identical to the case above except that the developer supplies NOTHING: no paymasterUrl, no
    // bundlerUrl, no injected clients. This is the invariant. If the SDK ever defaults these, the
    // rail below becomes "sponsored" (or the send dies reaching a baked-in endpoint) and this fails.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      deps: { rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN },
    } as never);

    const receipt = await evm.send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN });

    expect(receipt.rail).toBe("self-pay");
  });

  it("a fee token is not even validated without infra — it is dropped on the way to self-pay", async () => {
    // A gibberish fee token would raise UnsupportedFeeTokenError once sponsorship is reachable,
    // because the token is then checked against the target chain's registry. With no infra the
    // token is never consulted, so this send succeeds natively. A default endpoint would turn this
    // into a throw — a second, independent way the same regression surfaces.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      deps: { rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN },
    } as never);

    const receipt = await evm.send([{ to: TO, value: 0n, data: "0x" }], {
      chainId: 10,
      feeToken: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Address,
    });

    expect(receipt.rail).toBe("self-pay");
  });

  it("neither namespace factory dials anything at construction — a default endpoint would have to be reached", async () => {
    // The other shape a default could take: a client built eagerly from a baked-in URL. Both
    // factories are pure, so an injected fetch must never be called just by constructing them.
    const fetch = vi.fn(async () => {
      throw new Error("the SDK must not dial anything at construction");
    }) as unknown as Mock;

    createEvmNamespace({ connection: makeFakeConnection(), deps: { fetch } } as never);
    const { createSolanaNamespace } = await import("../../src/client/solana.js");
    createSolanaNamespace({ connection: makeFakeConnection(), deps: { fetch } } as never);

    expect(fetch).not.toHaveBeenCalled();
  });
});
