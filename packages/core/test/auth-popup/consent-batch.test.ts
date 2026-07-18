import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeFunctionData, getAddress, type Hex } from "viem";
import { AvokWalletImplementationABI, MODE_BATCH } from "@avokjs/contracts";
import { decodeSignConsent, type SignConsentRequest } from "../../src/auth-popup/sign/consent.js";
import { formatConsentDisplay } from "../../src/auth-popup/sign/consent-display.js";

/**
 * The consent screen must show what the user is ACTUALLY sending.
 *
 * An Avok send is never a bare ERC-20 call. It is a call to the user's own wallet contract —
 * `execute(MODE_BATCH, abi.encode(Call[]))` (ERC-7821) — with the real transfer buried inside
 * `executionData`. The decoder only tried `erc20Abi` against the OUTER call, matched nothing, and
 * rendered every single shared-origin send as:
 *
 *   ⚠ Unrecognized call to 0xcB99… — value 0 wei, data 0xe9ae5c53…
 *
 * A wall of hex with no recipient and no amount. That is worse than showing nothing: it LOOKS like a
 * safety check while withholding the only two facts that matter. It was caught in live testing, by
 * approving a real transaction blind.
 */

const ARC = 5042002;
const USDC_ARC = getAddress("0x3600000000000000000000000000000000000000"); // Arc USDC (registry)
// Checksummed via getAddress — the decoder checksums what it reads, so the fixture must match.
const RECIPIENT = getAddress("0xcd2e72aebe2a203b84f46deec948e6465db51c75");

const CALLS_PARAM = [
  {
    type: "tuple[]",
    components: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
] as const;

/** `transfer(RECIPIENT, 200000)` — 0.2 USDC at 6dp. */
const ERC20_TRANSFER: Hex =
  "0xa9059cbb000000000000000000000000cd2e72aebe2a203b84f46deec948e6465db51c750000000000000000000000000000000000000000000000000000000000030d40";

function executeBatch(calls: { to: Hex; value: bigint; data: Hex }[]): Hex {
  const executionData = encodeAbiParameters(CALLS_PARAM, [calls]);
  return encodeFunctionData({
    abi: AvokWalletImplementationABI,
    functionName: "execute",
    args: [MODE_BATCH, executionData],
  });
}

function consentFor(data: Hex, to = "0xcB994f2B438e19C9e444A77c95A8D649F047A180") {
  const request = {
    op: "signTransaction",
    tx: { to, value: 0n, data, chainId: ARC },
  } as unknown as SignConsentRequest;
  return decodeSignConsent(request);
}

describe("the consent screen unwraps the wallet's own execute() batch", () => {
  it("shows the recipient and amount of a real send, not raw calldata", () => {
    const data = executeBatch([{ to: USDC_ARC, value: 0n, data: ERC20_TRANSFER }]);
    const consent = consentFor(data);

    expect(consent.op).toBe("signTransaction");
    if (consent.op !== "signTransaction") throw new Error("unreachable");

    const [call] = consent.calls;
    expect(call?.kind).toBe("erc20-transfer");
    expect(call?.token?.counterparty).toBe(RECIPIENT);
    expect(call?.token?.baseUnits).toBe("200000");

    // The thing the human actually reads.
    const lines = formatConsentDisplay(consent);
    expect(lines.join("\n")).toContain(RECIPIENT);
    expect(lines.join("\n")).not.toContain("Unrecognized call");
    expect(lines.join("\n")).not.toContain("0xe9ae5c53");
  });

  it("decodes EVERY call in a multi-call batch — none may be collapsed away", () => {
    const data = executeBatch([
      { to: USDC_ARC, value: 0n, data: ERC20_TRANSFER },
      { to: RECIPIENT, value: 1_000n, data: "0x" }, // a native send alongside it
    ]);
    const consent = consentFor(data);
    if (consent.op !== "signTransaction") throw new Error("unreachable");

    expect(consent.calls).toHaveLength(2);
    expect(consent.calls[0]?.kind).toBe("erc20-transfer");
    expect(consent.calls[1]?.kind).toBe("native");
    expect(consent.calls[1]?.valueWei).toBe("1000");
  });

  // The safety property: unwrapping must never make an unknown call LOOK understood.
  it("still shows a plain non-wallet call as an unrecognized raw call", () => {
    const consent = consentFor("0xdeadbeef", RECIPIENT);
    if (consent.op !== "signTransaction") throw new Error("unreachable");

    expect(consent.calls[0]?.kind).toBe("raw");
    expect(formatConsentDisplay(consent).join("\n")).toContain("Unrecognized call");
  });

  it("falls back to the raw call when the batch payload itself cannot be decoded", () => {
    // A well-formed execute() whose executionData is garbage: we must NOT pretend to have read it.
    const data = encodeFunctionData({
      abi: AvokWalletImplementationABI,
      functionName: "execute",
      args: [MODE_BATCH, "0xdead"],
    });
    const consent = consentFor(data);
    if (consent.op !== "signTransaction") throw new Error("unreachable");

    expect(consent.calls).toHaveLength(1);
    expect(consent.calls[0]?.kind).toBe("raw"); // shown as raw, never dropped
  });
});

/**
 * THE SELF-PAY CEILING IS DERIVED FROM THE SIGNED BYTES — nothing else is admissible here.
 *
 * A self-pay transaction commits no fee call, so this screen has no exact fee to decode. It does have
 * `gas` and `maxFeePerGas`, which the signature covers, and whose product is the most the transaction
 * can cost. That is the disclosure. The app's own (more flattering) estimate is not: the origin has no
 * RPC to check it against, and a consent screen that renders unverifiable numbers supplied by the app
 * it is meant to constrain protects nobody.
 */
describe("self-pay discloses the fee ceiling the signature commits to", () => {
  it("derives maxFeeWei from gas × maxFeePerGas on a signSend", () => {
    const data = executeBatch([{ to: USDC_ARC, value: 0n, data: ERC20_TRANSFER }]);
    const consent = decodeSignConsent({
      op: "signSend",
      tx: {
        to: "0xcB994f2B438e19C9e444A77c95A8D649F047A180",
        value: 0n,
        data,
        chainId: ARC,
        gas: 170_000n,
        maxFeePerGas: 4_000_000_000n,
      },
    } as unknown as SignConsentRequest);

    expect(consent.op).toBe("signSend");
    if (consent.op !== "signSend") throw new Error("unreachable");
    expect(consent.maxFeeWei).toBe(170_000n * 4_000_000_000n);
    // Self-pay reimburses no one, so there must be no fee call masquerading as one.
    expect(consent.fee).toBeUndefined();
  });

  it("omits the ceiling when the transaction does not pin one (nothing to honestly claim)", () => {
    const data = executeBatch([{ to: USDC_ARC, value: 0n, data: ERC20_TRANSFER }]);
    const consent = consentFor(data); // no gas / maxFeePerGas
    if (consent.op !== "signTransaction") throw new Error("unreachable");
    expect(consent.maxFeeWei).toBeUndefined();
  });
});

/**
 * A 4337 sponsored UserOp carries the SAME `execute(MODE_BATCH, calls)` in its callData, so its consent
 * must unwrap it exactly like a self-pay send — the paymaster paying the gas does not exempt the user
 * from seeing what they send. And when the wallet is still undelegated the UserOp installs the 7702
 * delegate, which this one approval also grants: it must be on screen.
 */
describe("signUserOp consent unwraps the UserOp callData and discloses delegation", () => {
  const WALLET = "0xcB994f2B438e19C9e444A77c95A8D649F047A180" as const;
  const userOpReq = (data: Hex, authorization?: { chainId: number; address: Hex; nonce: number }) =>
    ({ op: "signUserOp", userOp: { sender: WALLET, callData: data }, chainId: ARC, authorization } as unknown as SignConsentRequest);

  it("shows the recipient and amount from the UserOp batch, not raw calldata", () => {
    const data = executeBatch([{ to: USDC_ARC, value: 0n, data: ERC20_TRANSFER }]);
    const consent = decodeSignConsent(userOpReq(data));

    expect(consent.op).toBe("signUserOp");
    if (consent.op !== "signUserOp") throw new Error("unreachable");
    expect(consent.calls[0]?.kind).toBe("erc20-transfer");
    expect(consent.calls[0]?.token?.counterparty).toBe(RECIPIENT);

    const lines = formatConsentDisplay(consent).join("\n");
    expect(lines).toContain(RECIPIENT);
    expect(lines).not.toContain("Unrecognized call");
  });

  it("surfaces the 7702 delegation when the account is undelegated", () => {
    const data = executeBatch([{ to: USDC_ARC, value: 0n, data: ERC20_TRANSFER }]);
    const delegate = "0x1234567890123456789012345678901234567890" as const;
    const consent = decodeSignConsent(userOpReq(data, { chainId: ARC, address: delegate, nonce: 0 }));

    if (consent.op !== "signUserOp") throw new Error("unreachable");
    expect(consent.delegation).toBe(delegate);
    expect(formatConsentDisplay(consent).join("\n")).toContain(`account upgrade to ${delegate}`);
  });
});
