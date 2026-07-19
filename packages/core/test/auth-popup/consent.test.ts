import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, getAddress, parseUnits } from "viem";
import { decodeConsent, decodeSignConsent } from "../../src/auth-popup/sign/consent.js";

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
