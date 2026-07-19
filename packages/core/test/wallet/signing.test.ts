import { describe, expect, test } from "vitest";
import { recoverMessageAddress, recoverTypedDataAddress, type TypedDataDefinition } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { createWallet } from "../../src/wallet/wallet.js";
import { signMessage, signSiwe, signTypedData } from "../../src/wallet/signing.js";
import { FakePasskeyAdapter } from "./fakes.js";

const typedData: TypedDataDefinition = {
  domain: { name: "Avok", version: "1", chainId: 10 },
  types: { Thing: [{ name: "n", type: "uint256" }] },
  primaryType: "Thing",
  message: { n: 7n },
};

describe("signing", () => {
  test("signMessage produces an EIP-191 signature recoverable to the wallet", async () => {
    const pk = new FakePasskeyAdapter();
    const { state } = await createWallet({ passkey: pk, networkName: "Qudi" });
    const sig = await signMessage({ state, passkey: pk, message: "hello" });
    expect(await recoverMessageAddress({ message: "hello", signature: sig })).toBe(state.evmAddress);
  });

  test("signTypedData produces an EIP-712 signature recoverable to the wallet", async () => {
    const pk = new FakePasskeyAdapter();
    const { state } = await createWallet({ passkey: pk, networkName: "Qudi" });
    const sig = await signTypedData({ state, passkey: pk, typedData });
    expect(await recoverTypedDataAddress({ ...typedData, signature: sig })).toBe(state.evmAddress);
  });

  test("signSiwe builds an EIP-4361 message for the wallet address and signs it", async () => {
    const pk = new FakePasskeyAdapter();
    const { state } = await createWallet({ passkey: pk, networkName: "Qudi" });
    const { message, signature } = await signSiwe({
      state, passkey: pk,
      params: { domain: "qudi.fi", uri: "https://qudi.fi", version: "1", chainId: 10, nonce: "abcdef12" },
    });
    expect(parseSiweMessage(message).address).toBe(state.evmAddress);
    expect(await recoverMessageAddress({ message, signature })).toBe(state.evmAddress);
  });
});
