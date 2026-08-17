/**
 * BRING-YOUR-OWN sponsorship invariant.
 *
 * HARD INVARIANT: the SDK never sponsors a transaction on infrastructure the developer did not
 * supply. It ships no default bundler and no default paymaster, and it
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
 *   - not supplied -> SponsorshipUnavailableError, and the bundler is never constructed
 * A hardcoded default would make the second case behave like the first, which is precisely the
 * assertion that then fails. Asserting only the negative case would not do: it passes for any
 * reason the send fails, including reasons that have nothing to do with sponsorship — which is why
 * the negative case pins the specific error CLASS and not merely "it threw".
 *
 * What "no infra" produces is an error (see sponsorship-required.test.ts): a request the SDK cannot
 * serve fails rather than quietly charging the user native gas. This file cares only that nothing is
 * ever supplied on the developer's behalf.
 *
 * MUTATION: give canSponsor() a default endpoint —
 *   return Boolean((paymasterUrl || deps?.paymaster || "https://…") && (bundlerUrl || deps?.bundler || "https://…"))
 * — and the two "WITHOUT infra" tests must fail. Re-verified after the strict-default change: 2 of 4
 * fail, and the 2 that survive are the WITH-infra case and the construction check, which that mutation
 * does not touch.
 *
 * An earlier draft of this file asserted only `rejects.not.toThrow(/unsupported fee token/i)` on a
 * send with no RPC. It passed the mutation above, because the send was already failing upstream for
 * an unrelated reason — a negative assertion on a path that can fail earlier proves nothing. That is
 * why the assertions here are a PAIR on `receipt.rail` rather than a single negative.
 */
import { describe, it, expect, vi, type Mock } from "vitest";
import type { Address, Hex } from "viem";
import { createEvmNamespace } from "../../src/client/evm.js";
import { SponsorshipUnavailableError } from "../../src/client/sponsorship-error.js";
import { UnsupportedFeeTokenError } from "../../src/client/fee-token-error.js";
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
    }),
    status: () => true,
    signTypedData: vi.fn(async () => "0xsig" as Hex),
    signAuthorization: vi.fn(async (a: object) => ({ ...a, r: "0xr" as Hex, s: "0xs" as Hex, yParity: 0 })),
    signTransaction: vi.fn(async () => "0xserialized" as Hex),
    // The native-gas rail signs through `signSend` (one gesture: tx + any 7702 authorization).
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

  it("WITHOUT any infra, the SAME send cannot be sponsored — no default endpoint exists to sponsor it", async () => {
    // Identical to the case above except that the developer supplies NOTHING: no paymasterUrl, no
    // bundlerUrl, no injected clients. This is the invariant. If the SDK ever defaults these, the send
    // below succeeds on the sponsored rail (or dies reaching a baked-in endpoint) instead of reporting
    // the rail as absent, and this fails.
    //
    // Pinning the CLASS is what keeps this honest: `rejects.toThrow()` alone would pass on a fake-RPC
    // hiccup and prove nothing about sponsorship. The error also names which side is missing, so a
    // regression that supplied only one endpoint would show up here rather than as a vague failure.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      deps: { rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN },
    } as never);

    const err = await evm
      .send([{ to: TO, value: 0n, data: "0x" }], { chainId: 10, feeToken: FEE_TOKEN })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SponsorshipUnavailableError);
    expect(err.missing).toEqual(["paymasterUrl", "bundlerUrl"]);
  });

  it("a fee token is not even validated without infra — the absent rail is reported first", async () => {
    // A gibberish fee token raises UnsupportedFeeTokenError once sponsorship is reachable, because the
    // token is then checked against the target chain's registry. With no infra the token is never
    // consulted at all, so what comes back names the missing endpoints and NOT the token.
    //
    // That ordering is the point: told "unsupported fee token", a developer goes and checks their token
    // address, which is fine. The actual fault is that they configured no rail. A default endpoint would
    // flip this to the token error — a second, independent way the same regression surfaces.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      deps: { rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN },
    } as never);

    const err = await evm
      .send([{ to: TO, value: 0n, data: "0x" }], {
        chainId: 10,
        feeToken: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Address,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SponsorshipUnavailableError);
    expect(err).not.toBeInstanceOf(UnsupportedFeeTokenError);
  });

  it("the namespace factory dials nothing at construction — a default endpoint would have to be reached", async () => {
    // The other shape a default could take: a client built eagerly from a baked-in URL. The factory
    // is pure, so an injected fetch must never be called just by constructing it.
    const fetch = vi.fn(async () => {
      throw new Error("the SDK must not dial anything at construction");
    }) as unknown as Mock;

    createEvmNamespace({ connection: makeFakeConnection(), deps: { fetch } } as never);

    expect(fetch).not.toHaveBeenCalled();
  });
});
