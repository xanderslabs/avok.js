import { expect, test, vi } from "vitest";
import { stringToHex } from "viem";
import type { ClientConfig } from "@avokjs/sdk-core";
import { createEip1193Provider } from "../src/eip1193.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const SOL = "SoLaNaAddr11111111111111111111111111111111";

function fakeConfig(signMessage = vi.fn(), signTypedData = vi.fn()): ClientConfig {
  return {
    connection: {
      account: () => ({ evm: { address: ADDR }, solana: { address: SOL } }),
      status: () => true,
      signMessage,
      signTypedData,
    },
  } as unknown as ClientConfig;
}

test("personal_sign decodes the hex message to its UTF-8 preimage and returns the signature", async () => {
  const signMessage = vi.fn().mockResolvedValue("0xdeadbeef");
  const p = createEip1193Provider(fakeConfig(signMessage), { defaultChainId: 8453 });
  const out = await p.request({ method: "personal_sign", params: [stringToHex("hello world"), ADDR] });
  expect(signMessage).toHaveBeenCalledWith({ message: "hello world" });
  expect(out).toBe("0xdeadbeef");
});

test("personal_sign accepts a raw (non-hex) UTF-8 string as-is", async () => {
  const signMessage = vi.fn().mockResolvedValue("0xabc0");
  const p = createEip1193Provider(fakeConfig(signMessage), { defaultChainId: 8453 });
  await p.request({ method: "personal_sign", params: ["plain text", ADDR] });
  expect(signMessage).toHaveBeenCalledWith({ message: "plain text" });
});

test("eth_signTypedData_v4 JSON-parses the payload and forwards the typed data object", async () => {
  const signTypedData = vi.fn().mockResolvedValue("0xfeed");
  const p = createEip1193Provider(fakeConfig(vi.fn(), signTypedData), { defaultChainId: 8453 });
  const typed = {
    domain: { name: "Avok", chainId: 8453 },
    types: { Mail: [{ name: "note", type: "string" }] },
    primaryType: "Mail",
    message: { note: "hi" },
  };
  const out = await p.request({ method: "eth_signTypedData_v4", params: [ADDR, JSON.stringify(typed)] });
  expect(signTypedData).toHaveBeenCalledWith(typed);
  expect(out).toBe("0xfeed");
});

test("a sign for a non-active address rejects with 4100", async () => {
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453 });
  const other = "0x2222222222222222222222222222222222222222";
  await expect(
    p.request({ method: "personal_sign", params: [stringToHex("x"), other] }),
  ).rejects.toMatchObject({ code: 4100 });
});
