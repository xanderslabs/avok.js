/**
 * SPONSORSHIP IS REQUIRED BY DEFAULT — asking for it and not getting it is an error, not a downgrade.
 *
 * A `feeToken` IS the sponsorship request, and so is `sponsored: true`. When no rail can serve it, the
 * SDK throws `SponsorshipUnavailableError`. Asking is BINARY: served, or an error. There is no
 * degrade-to-native-gas mode and no flag that enables one.
 *
 * ── WHY THE DEFAULT IS THE STRICT ONE ────────────────────────────────────────────────────────────
 *
 * Degrading looks graceful and is not. Two users, one config bug:
 *
 *   - The user this rail EXISTS for holds the fee token and no native gas. A degraded send does not
 *     charge them — it dies on insufficient funds, an error naming a native balance. The developer
 *     debugs a wallet-funding problem that is actually a missing `PAYMASTER_URL`.
 *   - The user who happens to hold a little native is worse off: the send succeeds and spends THEIR
 *     OWN funds on gas the developer intended to sponsor. The SDK did something nobody authorized,
 *     and it did it silently.
 *
 * Neither is a balance problem. Both are a config gap, and a config gap must not wear a user-balance
 * costume. So the ask is per-TRANSACTION, matching how sponsorship is requested in the first place.
 *
 * ── MUTATION EVIDENCE (run when written) ─────────────────────────────────────────────────────────
 *
 *  - Replace `throw noRail(chainId)` with `return NATIVE_GAS` in resolveSponsorship (evm.ts), which is
 *    exactly the old degrade — the throw tests below fail. That is the business rule, defended.
 *  - Swap the thrown class for a generic `Error` — "distinct, dev-legible class" fails. This matters
 *    independently: a dev must be able to `instanceof`-narrow a misconfiguration apart from a real
 *    user-balance failure, which is the whole point of not degrading.
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
    }),
    status: () => true,
    signTypedData: vi.fn(async () => "0xsig" as Hex),
    signAuthorization: vi.fn(async (a: object) => ({ ...a, r: "0xr" as Hex, s: "0xs" as Hex, yParity: 0 })),
    signSend: vi.fn(async () => "0xserialized" as Hex),
    signUserOp: vi.fn(async () => ({ signature: "0xu5e40p" as Hex })),
  } as unknown as Connection;
}

const baseDeps = () => ({ rpc: makeFakeRpc({ delegated: NON_ZERO_IMPL, nonce: 3 }), chain: TEST_CHAIN });
const noInfra = () => createEvmNamespace({ connection: makeFakeConnection(), deps: baseDeps() } as never);

describe("sponsored: required (the default)", () => {
  it("THROWS by default — a sponsorship request with no rail is not silently self-paid", async () => {
    await expect(noInfra().send(CALLS, { chainId: 10, feeToken: FEE_TOKEN })).rejects.toBeInstanceOf(
      SponsorshipUnavailableError,
    );
  });

  it("throws at SIMULATE too, not only at send — the gap is visible before a user is involved", async () => {
    // simulate() is what a UI calls to price a send and render a confirm screen. Failing only at send()
    // would mean the app painted a fee, the user approved it, and THEN the config error surfaced.
    await expect(noInfra().simulate(CALLS, { chainId: 10, feeToken: FEE_TOKEN })).rejects.toBeInstanceOf(
      SponsorshipUnavailableError,
    );
  });

  it("throws BEFORE the passkey ceremony — no signature is ever requested", async () => {
    // The load-bearing property. Every signing verb on the connection is a passkey gesture; if any of
    // them is reached, the user was prompted to authorise a transaction that could never be sponsored.
    const connection = makeFakeConnection() as Connection & {
      signSend: ReturnType<typeof vi.fn>;
      signUserOp: ReturnType<typeof vi.fn>;
      signTypedData: ReturnType<typeof vi.fn>;
      signAuthorization: ReturnType<typeof vi.fn>;
    };
    const evm = createEvmNamespace({ connection, deps: baseDeps() } as never);

    await expect(evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN })).rejects.toThrow();

    expect(connection.signSend).not.toHaveBeenCalled();
    expect(connection.signUserOp).not.toHaveBeenCalled();
    expect(connection.signTypedData).not.toHaveBeenCalled();
    expect(connection.signAuthorization).not.toHaveBeenCalled();
  });

  it("is a DISTINCT class, and never an insufficient-funds or generic gas error", async () => {
    // A developer must be able to tell "I forgot to set PAYMASTER_URL" apart from "this user is broke".
    // If this ever became a generic Error, or the message read like a balance problem, the misconfig
    // would be triaged as a user-funding issue — the exact failure the strict default prevents.
    const err = await noInfra()
      .send(CALLS, { chainId: 10, feeToken: FEE_TOKEN })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SponsorshipUnavailableError);
    expect(err.name).toBe("SponsorshipUnavailableError");
    expect(err.message).toMatch(/sponsorship/i);
    expect(err.message).not.toMatch(/insufficient|balance|funds/i);
    expect(err.chain).toBe("eip155:10");
  });

  it("names WHICH side is missing, because half-configured is the common case", async () => {
    // A bundler with no paymaster is the shape a half-finished deployment takes. "Sponsorship
    // unavailable" alone would send someone hunting through config for the one they already set.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      bundlerUrl: "https://bundler.test",
      deps: baseDeps(),
    } as never);

    const err = await evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN }).catch((e) => e);
    expect(err).toBeInstanceOf(SponsorshipUnavailableError);
    expect(err.hasBundler).toBe(true);
    expect(err.hasPaymaster).toBe(false);
    expect(err.missing).toEqual(["paymasterUrl"]);
    expect(err.message).toMatch(/paymasterUrl/);
    expect(err.message).not.toMatch(/bundlerUrl/);
  });

  it("counts an INJECTED client as configured, not just a URL", async () => {
    // deps.bundler satisfies the bundler side. Reporting it as missing would tell a developer their
    // bundler is absent while they are looking at the one they injected.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      deps: { ...baseDeps(), bundler: {} as never },
    } as never);

    const err = await evm.send(CALLS, { chainId: 10, feeToken: FEE_TOKEN }).catch((e) => e);
    expect(err.hasBundler).toBe(true);
    expect(err.hasPaymaster).toBe(false);
  });

  it("does NOT fire for a native-gas send — sponsorship still has to be asked for", async () => {
    // No fee token means the app chose native-gas. The rule is "when I ask for sponsorship, mean it",
    // not "every send must be sponsored". A native-gas-only app never sees this error.
    const receipt = await noInfra().send(CALLS, { chainId: 10, feeToken: null });
    expect(receipt.rail).toBe("native-gas");
  });

  it("does NOT fire when a fee token is omitted entirely", async () => {
    const receipt = await noInfra().send(CALLS, { chainId: 10 });
    expect(receipt.rail).toBe("native-gas");
  });
});

describe("fee-token validation once a rail DOES exist", () => {
  it("still rejects a token the target chain does not know", () => {
    // The rail check runs first, so this only becomes reachable with infra configured. It pins that
    // reaching the sponsored rail does not become a licence to forward a meaningless token.
    const evm = createEvmNamespace({
      connection: makeFakeConnection(),
      paymasterUrl: "https://pm.test",
      bundlerUrl: "https://bundler.test",
      deps: baseDeps(),
    } as never);

    return expect(
      evm.simulate(CALLS, { chainId: 10, feeToken: "0x9999999999999999999999999999999999999999" }),
    ).rejects.toThrow(/fee token/i);
  });
});
