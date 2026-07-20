/**
 * `requireSponsorship` — the opt-in that turns a silent self-pay degrade into a loud failure.
 *
 * By default a fee token on a chain with no bundler+paymaster degrades to self-pay (SPEC §1). That
 * is right for an app sponsoring on some chains and not others, and wrong for one whose paymaster URL
 * never reached production — and nothing in the SDK can tell those apart, because a deliberately
 * unsponsored chain and a mistyped env var are both an absent string.
 *
 * The failure this prevents is not a surprise charge. An app onboarding users who hold no native gas
 * at all — the case sponsorship exists for — sees the degraded send fail on insufficient funds, an
 * error naming a balance rather than the missing endpoint that caused it.
 *
 * MUTATION: deleting the `if (requireSponsorship) throw` branch in resolveFeeToken (evm.ts) must fail
 * the "throws" tests below. Verified when written.
 */
import { describe, it, expect, vi } from "vitest";
import type { Address, Hex } from "viem";
import { createEvmNamespace } from "../../src/client/evm.js";
import { SponsorshipUnavailableError } from "../../src/client/sponsorship-error.js";
import { getChainProfile } from "../../src/evm/index.js";
import type { Connection } from "../../src/types.js";
import { makeFakeRpc } from "../client/fakes.js";

const CHAIN = getChainProfile(10)!;
const FEE_TOKEN = Object.values(CHAIN.tokens)[0]!.address;
const NON_ZERO_IMPL = "0x1234567890123456789012345678901234567890" as const satisfies Address;
const TEST_CHAIN = { ...CHAIN, canonicalImplementation: NON_ZERO_IMPL };
const TO = "0x2222222222222222222222222222222222222222" as const;
const CALLS = [{ to: TO, value: 0n, data: "0x" as const }];

function makeFakeConnection(): Connection {
  return {
    account: () => ({
      evm: { address: "0x1111111111111111111111111111111111111111" as Address },
      solana: { address: "11111111111111111111111111111111" },
    }),
    status: () => true,
    signTypedData: vi.fn(async () => "0xsig" as Hex),
    signAuthorization: vi.fn(async (a: object) => ({ ...a, r: "0xr" as Hex, s: "0xs" as Hex, yParity: 0 })),
    signSend: vi.fn(async () => "0xserialized" as Hex),
    signUserOp: vi.fn(async () => ({ signature: "0xu5e40p" as Hex })),
  } as unknown as Connection;
}

const baseDeps = () => ({ rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN });

describe("requireSponsorship", () => {
  it("throws SponsorshipUnavailableError instead of silently self-paying", async () => {
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      requireSponsorship: true,
      deps: baseDeps(),
    } as never);

    await expect(evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN })).rejects.toBeInstanceOf(
      SponsorshipUnavailableError,
    );
  });

  it("throws BEFORE anything is signed — nothing has happened the app must reconcile", async () => {
    // The whole value of failing here rather than on the receipt is that no signature was taken and
    // no transaction exists. If this ever moved later, an app would be explaining a transaction the
    // user did not expect instead of a config error.
    const connection = makeFakeConnection() as Connection & { signSend: ReturnType<typeof vi.fn> };
    const evm = createEvmNamespace({ connection, requireSponsorship: true, deps: baseDeps() } as never);

    await expect(evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN })).rejects.toThrow();
    expect(connection.signSend).not.toHaveBeenCalled();
  });

  it("names WHICH side is missing, because half-configured is the common case", async () => {
    // A bundler with no paymaster is the shape a half-finished deployment takes. "Sponsorship
    // unavailable" alone would send someone hunting through config for the one they already set.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      requireSponsorship: true,
      bundlerUrl: "https://bundler.test",
      deps: baseDeps(),
    } as never);

    const err = await evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN }).catch((e) => e);
    expect(err).toBeInstanceOf(SponsorshipUnavailableError);
    expect(err.hasBundler).toBe(true);
    expect(err.hasPaymaster).toBe(false);
    expect(err.message).toMatch(/paymasterUrl/);
    expect(err.message).not.toMatch(/bundlerUrl is not configured/);
  });

  it("counts an INJECTED client as configured, not just a URL", async () => {
    // deps.bundler satisfies the bundler side. Reporting it as missing would tell a developer their
    // bundler is absent while they are looking at the one they injected.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      requireSponsorship: true,
      deps: { ...baseDeps(), bundler: {} as never },
    } as never);

    const err = await evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN }).catch((e) => e);
    expect(err.hasBundler).toBe(true);
    expect(err.hasPaymaster).toBe(false);
  });

  it("does NOT fire for a self-pay send — sponsorship still has to be asked for", async () => {
    // No fee token means the app chose self-pay. The flag says "when I ask for sponsorship, mean
    // it", not "every send must be sponsored".
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      requireSponsorship: true,
      deps: baseDeps(),
    } as never);

    const receipt = await evm.send(CALLS, { chainId: 10, feeToken: null });
    expect(receipt.rail).toBe("self-pay");
  });

  it("is off by default — the graceful multi-chain degrade is unchanged", async () => {
    // The existing contract for everyone who does not opt in: same call, same silent degrade.
    const evm = createEvmNamespace({ connection: makeFakeConnection(), deps: baseDeps() } as never);

    const receipt = await evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN });
    expect(receipt.rail).toBe("self-pay");
  });
});
