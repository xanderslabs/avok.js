import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { simulationPayloadFor } from "../../src/auth-popup/sign/simulate-payload.js";
import type { SignConsentRequest } from "../../src/auth-popup/sign/consent.js";

const WALLET = getAddress("0xcB994f2B438e19C9e444A77c95A8D649F047A180");
const OTHER = getAddress("0x9999999999999999999999999999999999999999");

describe("simulationPayloadFor", () => {
  it("extracts a self-call payload from signTransaction — account and calls[0].to are the tx target", () => {
    const request: SignConsentRequest = {
      op: "signTransaction",
      tx: { to: WALLET, value: 0n, data: "0xabcd", chainId: 8453 },
    } as unknown as SignConsentRequest;

    const payload = simulationPayloadFor(request);

    expect(payload).toEqual({
      chainId: 8453,
      account: WALLET,
      calls: [{ to: WALLET, value: 0n, data: "0xabcd" }],
    });
  });

  it("extracts the same shape from signSend (composite send), ignoring the authorization", () => {
    const request: SignConsentRequest = {
      op: "signSend",
      tx: { to: WALLET, value: 100n, data: "0x", chainId: 8453 },
      authorization: { chainId: 8453, address: OTHER, nonce: 0 },
    } as unknown as SignConsentRequest;

    const payload = simulationPayloadFor(request);

    expect(payload).toEqual({
      chainId: 8453,
      account: WALLET,
      calls: [{ to: WALLET, value: 100n, data: "0x" }],
    });
  });

  it("returns null for signTransaction with no `to` (contract creation) — nothing to self-call", () => {
    const request: SignConsentRequest = {
      op: "signTransaction",
      tx: { to: null, value: 0n, data: "0xabcd", chainId: 8453 },
    } as unknown as SignConsentRequest;

    expect(simulationPayloadFor(request)).toBeNull();
  });

  it("extracts a self-call payload from signUserOp using userOp.sender and callData", () => {
    const request: SignConsentRequest = {
      op: "signUserOp",
      userOp: { sender: WALLET, callData: "0xf00d" },
      chainId: 10,
    } as unknown as SignConsentRequest;

    const payload = simulationPayloadFor(request);

    expect(payload).toEqual({
      chainId: 10,
      account: WALLET,
      calls: [{ to: WALLET, value: 0n, data: "0xf00d" }],
    });
  });

  it("extracts feeCalls + userCalls from an Avok-batch signTypedData request", () => {
    const request: SignConsentRequest = {
      op: "signTypedData",
      typedData: {
        domain: { chainId: 8453, verifyingContract: WALLET },
        message: {
          feeCalls: [{ to: OTHER, value: 0n, data: "0xfee" }],
          userCalls: [{ to: OTHER, value: 0n, data: "0xuser" }],
          nonce: 1n,
          deadline: 0n,
        },
      },
    } as unknown as SignConsentRequest;

    const payload = simulationPayloadFor(request);

    expect(payload).toEqual({
      chainId: 8453,
      account: WALLET,
      calls: [
        { to: OTHER, value: 0n, data: "0xfee" },
        { to: OTHER, value: 0n, data: "0xuser" },
      ],
    });
  });

  it("extracts the same shape from signSponsored", () => {
    const request: SignConsentRequest = {
      op: "signSponsored",
      typedData: {
        domain: { chainId: 8453, verifyingContract: WALLET },
        message: { feeCalls: [], userCalls: [{ to: OTHER, value: 0n, data: "0xuser" }], nonce: 1n, deadline: 0n },
      },
    } as unknown as SignConsentRequest;

    const payload = simulationPayloadFor(request);

    expect(payload).toEqual({
      chainId: 8453,
      account: WALLET,
      calls: [{ to: OTHER, value: 0n, data: "0xuser" }],
    });
  });

  it("returns null for a generic (non-Avok-batch) signTypedData request — nothing to simulate", () => {
    const request: SignConsentRequest = {
      op: "signTypedData",
      typedData: {
        domain: { chainId: 8453, verifyingContract: OTHER },
        message: { anything: "else" },
      },
    } as unknown as SignConsentRequest;

    expect(simulationPayloadFor(request)).toBeNull();
  });

  it("returns null for signMessage, signSiwe, and signAuthorization — no calls to simulate", () => {
    expect(simulationPayloadFor({ op: "signMessage", message: "hi" })).toBeNull();
    expect(
      simulationPayloadFor({
        op: "signSiwe",
        params: { domain: "d", uri: "u", version: "1", chainId: 1, nonce: "n" },
      } as unknown as SignConsentRequest),
    ).toBeNull();
    expect(
      simulationPayloadFor({
        op: "signAuthorization",
        authorization: { chainId: 8453, address: OTHER, nonce: 0 },
      } as unknown as SignConsentRequest),
    ).toBeNull();
  });
});
