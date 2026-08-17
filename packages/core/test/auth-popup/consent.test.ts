import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, getAddress, parseAbi, parseUnits } from "viem";
import { decodeConsent, decodeSignConsent } from "../../src/auth-popup/sign/consent.js";
import { formatConsentDisplay, displayText } from "../../src/auth-popup/sign/consent-display.js";

const OP_USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"; // from contracts registry (chain 10)

describe("decodeConsent", () => {
  it("decodes an ERC-20 transfer in userCalls and enriches with the registry token", () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: ["0x9999999999999999999999999999999999999999", parseUnits("5", 6)],
    });
    const view = decodeConsent({
      chainId: 10,
      typedData: {
        message: { feeCalls: [], userCalls: [{ to: OP_USDC, value: 0n, data }], nonce: 1n, deadline: 0n },
      } as never,
    });
    const line = view.calls[0];
    expect(line.kind).toBe("erc20-transfer");
    expect(line.token?.symbol).toBe("USDC");
    expect(line.token?.decimals).toBe(6);
    expect(line.token?.amount).toBe("5");
    expect(line.token?.baseUnits).toBe(parseUnits("5", 6).toString()); // "5000000"
    // counterparty is the ERC-20 recipient — the most security-critical field on the consent screen.
    expect(line.token?.counterparty).toBe(getAddress("0x9999999999999999999999999999999999999999"));
  });

  it("still surfaces recipient + amount for an ERC-20 transfer on an UNREGISTERED token", () => {
    // A token not in the registry (getTokenProfile → undefined). Must NOT hide the transfer as raw:
    // the recipient and base-unit amount are security-critical and must render (symbol/decimals unknown).
    const UNKNOWN_TOKEN = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: ["0x9999999999999999999999999999999999999999", 1234n],
    });
    const view = decodeConsent({
      chainId: 10,
      typedData: {
        message: { feeCalls: [], userCalls: [{ to: UNKNOWN_TOKEN, value: 0n, data }], nonce: 1n, deadline: 0n },
      } as never,
    });
    const line = view.calls[0];
    expect(line.kind).toBe("erc20-transfer");
    expect(line.token?.counterparty).toBe(getAddress("0x9999999999999999999999999999999999999999"));
    expect(line.token?.baseUnits).toBe("1234");
    expect(line.token?.symbol).toBeUndefined();
    expect(line.token?.decimals).toBeUndefined();
    expect(line.token?.amount).toBeUndefined();
  });

  it("surfaces spender + amount for an ERC-20 approve on an UNREGISTERED token", () => {
    const UNKNOWN_TOKEN = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: ["0x8888888888888888888888888888888888888888", 42n],
    });
    const view = decodeConsent({
      chainId: 10,
      typedData: {
        message: { feeCalls: [], userCalls: [{ to: UNKNOWN_TOKEN, value: 0n, data }], nonce: 1n, deadline: 0n },
      } as never,
    });
    const line = view.calls[0];
    expect(line.kind).toBe("erc20-approve");
    expect(line.token?.counterparty).toBe(getAddress("0x8888888888888888888888888888888888888888"));
    expect(line.token?.baseUnits).toBe("42");
    expect(line.token?.symbol).toBeUndefined();
  });

  it("falls back to raw for unknown calldata", () => {
    const view = decodeConsent({
      chainId: 10,
      typedData: {
        message: {
          feeCalls: [],
          userCalls: [{ to: "0x1234567890123456789012345678901234567890", value: 1n, data: "0xdeadbeef" }],
          nonce: 1n,
          deadline: 0n,
        },
      } as never,
    });
    expect(view.calls[0].kind).toBe("raw");
  });
});

describe("decodeSignConsent", () => {
  it("decodes a signMessage request to its message", () => {
    expect(decodeSignConsent({ op: "signMessage", message: "approve login" })).toEqual({
      op: "signMessage",
      message: "approve login",
    });
  });

  it("decodes a SponsoredBatch typedData to a ConsentView", () => {
    const typedData = {
      domain: { chainId: 10 },
      message: {
        feeCalls: [],
        userCalls: [{ to: "0x1234567890123456789012345678901234567890", value: 1n, data: "0xdeadbeef" }],
        nonce: 1n,
        deadline: 0n,
      },
    };
    const c = decodeSignConsent({ op: "signTypedData", typedData: typedData as never });
    expect(c.op).toBe("signTypedData");
    if (c.op === "signTypedData") expect(c.view.calls).toHaveLength(1);
  });

  it("decodes a signSiwe request to canonical fields", () => {
    const c = decodeSignConsent({
      op: "signSiwe",
      params: { domain: "example.com", uri: "https://example.com/path", version: "1", chainId: 1, nonce: "abc123" },
    });
    expect(c.op).toBe("signSiwe");
    if (c.op === "signSiwe") {
      expect(c.fields.domain).toBe("example.com");
      expect(c.fields.uri).toBe("https://example.com/path");
      expect(c.fields.chainId).toBe("1");
      expect(c.fields.nonce).toBe("abc123");
    }
  });

  it("surfaces SIWE resources in the decoded fields as a newline-joined string", () => {
    const resources = ["https://api.example.com/data", "https://api.example.com/profile"];
    const c = decodeSignConsent({
      op: "signSiwe",
      params: {
        domain: "example.com",
        uri: "https://example.com/",
        version: "1",
        chainId: 1,
        nonce: "xyz",
        resources,
      },
    });
    expect(c.op).toBe("signSiwe");
    if (c.op === "signSiwe") {
      // resources must be present and contain each URI so the user can review what they authorise.
      expect(c.fields.resources).toBe(resources.join("\n"));
      expect(c.fields.resources).toContain("https://api.example.com/data");
      expect(c.fields.resources).toContain("https://api.example.com/profile");
    }
  });

  it("omits resources field from decoded fields when not provided", () => {
    const c = decodeSignConsent({
      op: "signSiwe",
      params: { domain: "example.com", uri: "https://example.com/", version: "1", chainId: 1, nonce: "xyz" },
    });
    expect(c.op).toBe("signSiwe");
    if (c.op === "signSiwe") {
      expect(c.fields.resources).toBeUndefined();
    }
  });

  it("decodes a signTransaction request into a call list", () => {
    const c = decodeSignConsent({
      op: "signTransaction",
      tx: { to: "0x1234567890123456789012345678901234567890", value: 1n, data: "0x", chainId: 10 },
    });
    expect(c.op).toBe("signTransaction");
    if (c.op === "signTransaction") {
      expect(c.chainId).toBe(10);
      expect(c.calls).toHaveLength(1);
      expect(c.calls[0].kind).toBe("native");
    }
  });

  it("decodes a signAuthorization request to chainId + implementation", () => {
    const impl = getAddress("0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF");
    const c = decodeSignConsent({
      op: "signAuthorization",
      authorization: { address: impl, chainId: 10, nonce: 0 },
    });
    expect(c.op).toBe("signAuthorization");
    if (c.op === "signAuthorization") {
      expect(c.chainId).toBe(10);
      expect(c.implementation).toBe(impl);
    }
  });
});

// ─── Unrecognised EIP-712 ─────────────────────────────────────────────────────

const permit2Single = {
  domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
  primaryType: "PermitSingle",
  types: {
    PermitSingle: [
      { name: "details", type: "PermitDetails" },
      { name: "spender", type: "address" },
      { name: "sigDeadline", type: "uint256" },
    ],
    PermitDetails: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  message: {
    details: {
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amount: "1461501637330902918203684832716283019655932542975",
      expiration: 1900000000,
      nonce: 0,
    },
    spender: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
    sigDeadline: 1900000000,
  },
} as const;

describe("decodeSignConsent, unrecognised typed data", () => {
  // THE DEFECT. decodeConsent assumed Avok's own { feeCalls, userCalls } batch shape and threw a
  // TypeError on anything else. ceremony.ts caught it and rendered a dismiss-only screen, so the
  // user could not approve. Correct failure, total loss of function: Permit2 and ERC-2612 cover most
  // of DeFi's signature surface.
  it("describes a Permit2 payload instead of throwing", () => {
    const consent = decodeSignConsent({ op: "signTypedData", typedData: permit2Single as never });
    expect(consent.op).toBe("signTypedDataGeneric");
  });

  it("surfaces the domain and the primary type, which is what identifies the request", () => {
    const consent = decodeSignConsent({ op: "signTypedData", typedData: permit2Single as never });
    if (consent.op !== "signTypedDataGeneric") throw new Error("expected the generic view");
    expect(consent.view.primaryType).toBe("PermitSingle");
    expect(consent.view.domain.name).toBe("Permit2");
    expect(consent.view.domain.verifyingContract?.toLowerCase()).toBe("0x000000000022d473030f116ddee9f6b43ac78ba3");
  });

  it("flattens nested message fields with a dotted label, hiding nothing", () => {
    const consent = decodeSignConsent({ op: "signTypedData", typedData: permit2Single as never });
    if (consent.op !== "signTypedDataGeneric") throw new Error("expected the generic view");
    const labels = consent.view.fields.map((f) => f.label);
    expect(labels).toContain("details.token");
    expect(labels).toContain("spender");
    const spender = consent.view.fields.find((f) => f.label === "spender");
    expect(spender?.value.toLowerCase()).toBe("0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad");
  });

  it("still uses the batch view for Avok's own sponsored shape", () => {
    const consent = decodeSignConsent({
      op: "signTypedData",
      typedData: {
        domain: { chainId: 10 },
        primaryType: "Execute",
        types: {},
        message: { feeCalls: [], userCalls: [], nonce: 1n, deadline: 2n },
      } as never,
    });
    expect(consent.op).toBe("signTypedData");
  });

  it("throws when the domain carries no chainId, since the user must know the chain", () => {
    expect(() =>
      decodeSignConsent({
        op: "signTypedData",
        typedData: { domain: {}, primaryType: "Thing", types: {}, message: {} } as never,
      }),
    ).toThrow(/chainId/);
  });

  /**
   * SPOOF GUARD, and the reason the batch is matched on its EXACT shape.
   *
   * Detecting the batch by "has userCalls and feeCalls arrays" is not safe. A payload can carry both
   * as empty decoys AND the real fields of something else. The batch renderer reads only the two
   * arrays, so the screen would say "no calls" while the user signs a live ERC-2612 allowance: the
   * display and the signature would describe different things, which is the one thing a consent
   * screen exists to prevent.
   *
   * The signature commits to `primaryType` and to every message field. So anything carrying a field
   * the batch does not model is NOT the batch, and goes to the generic renderer, where every field
   * including the decoys is shown.
   */
  it("refuses to render a Permit as a batch just because it carries decoy call arrays", () => {
    const consent = decodeSignConsent({
      op: "signTypedData",
      typedData: {
        domain: { name: "USD Coin", chainId: 1, verifyingContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
        primaryType: "Permit",
        types: {},
        message: {
          owner: "0x1111111111111111111111111111111111111111",
          spender: "0x2222222222222222222222222222222222222222",
          value: 10n ** 30n,
          nonce: 0n,
          deadline: 1900000000n,
          userCalls: [],
          feeCalls: [],
        },
      } as never,
    });
    expect(consent.op).toBe("signTypedDataGeneric");
    if (consent.op !== "signTypedDataGeneric") throw new Error("expected the generic view");
    const labels = consent.view.fields.map((f) => f.label);
    // The allowance the user is actually granting must be on screen.
    expect(labels).toContain("spender");
    expect(labels).toContain("value");
  });
});

// ─── Approval-granting selectors ──────────────────────────────────────────────

const approvalAbi = parseAbi([
  "function setApprovalForAll(address operator, bool approved)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function transferFrom(address from, address to, uint256 amount)",
]);

const SPENDER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const A_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const AN_OWNER = "0x1111111111111111111111111111111111111111";

function txConsent(data: `0x${string}`) {
  return decodeSignConsent({
    op: "signTransaction",
    tx: { chainId: 1, to: A_TOKEN, value: 0n, data } as never,
  });
}

describe("approval-granting selectors", () => {
  it("decodes setApprovalForAll rather than showing raw hex", () => {
    const data = encodeFunctionData({ abi: approvalAbi, functionName: "setApprovalForAll", args: [SPENDER, true] });
    const consent = txConsent(data);
    if (consent.op !== "signTransaction") throw new Error("expected a transaction consent");
    expect(consent.calls[0].kind).toBe("erc721-approve-all");
    expect(displayText(formatConsentDisplay(consent)).join("\n")).toContain(SPENDER);
  });

  it("says plainly that setApprovalForAll covers every token in the collection", () => {
    const data = encodeFunctionData({ abi: approvalAbi, functionName: "setApprovalForAll", args: [SPENDER, true] });
    expect(displayText(formatConsentDisplay(txConsent(data))).join("\n")).toMatch(/all/i);
  });

  it("distinguishes revoking approval-for-all, which is safe", () => {
    const data = encodeFunctionData({ abi: approvalAbi, functionName: "setApprovalForAll", args: [SPENDER, false] });
    expect(displayText(formatConsentDisplay(txConsent(data))).join("\n")).toMatch(/revoke/i);
  });

  it("decodes increaseAllowance", () => {
    const data = encodeFunctionData({ abi: approvalAbi, functionName: "increaseAllowance", args: [SPENDER, 100n] });
    const consent = txConsent(data);
    if (consent.op !== "signTransaction") throw new Error("expected a transaction consent");
    expect(consent.calls[0].kind).toBe("erc20-increase-allowance");
  });

  it("decodes transferFrom and shows both the source and the destination", () => {
    const data = encodeFunctionData({ abi: approvalAbi, functionName: "transferFrom", args: [AN_OWNER, SPENDER, 5n] });
    const consent = txConsent(data);
    if (consent.op !== "signTransaction") throw new Error("expected a transaction consent");
    expect(consent.calls[0].kind).toBe("erc20-transfer-from");
    const rendered = displayText(formatConsentDisplay(consent)).join("\n");
    expect(rendered).toContain(AN_OWNER);
    expect(rendered).toContain(SPENDER);
  });

  it("still shows an unrecognised call in full, hiding nothing", () => {
    const consent = txConsent("0xdeadbeef");
    if (consent.op !== "signTransaction") throw new Error("expected a transaction consent");
    expect(consent.calls[0].kind).toBe("raw");
    expect(displayText(formatConsentDisplay(consent)).join("\n")).toContain("0xdeadbeef");
  });
});
