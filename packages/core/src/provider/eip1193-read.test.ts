import { expect, test, vi } from "vitest";
import type { ClientConfig } from "../index.js";
import { createEip1193Provider } from "./eip1193.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const SOL = "SoLaNaAddr11111111111111111111111111111111";

/** A minimal own-origin connection double: logged in, one account. */
function fakeConfig(over: Partial<{ account: () => unknown; status: () => boolean }> = {}): ClientConfig {
  return {
    connection: {
      account: over.account ?? (() => ({ evm: { address: ADDR }, solana: { address: SOL } })),
      status: over.status ?? (() => true),
    },
  } as unknown as ClientConfig;
}

test("eth_requestAccounts / eth_accounts return the active EVM address", async () => {
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453 });
  expect(await p.request({ method: "eth_requestAccounts" })).toEqual([ADDR]);
  expect(await p.request({ method: "eth_accounts" })).toEqual([ADDR]);
});

test("eth_accounts returns [] when no account is active", async () => {
  const p = createEip1193Provider(fakeConfig({ account: () => null, status: () => false }), { defaultChainId: 8453 });
  expect(await p.request({ method: "eth_accounts" })).toEqual([]);
});

test("eth_chainId returns the hex default chain", async () => {
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453 });
  expect(await p.request({ method: "eth_chainId" })).toBe("0x2105"); // 8453
});

test("eth_chainId defaults to mainnet (0x1) when no default is given", async () => {
  const p = createEip1193Provider(fakeConfig());
  expect(await p.request({ method: "eth_chainId" })).toBe("0x1");
});

test("an unsupported method rejects with EIP-1193 code 4200", async () => {
  const p = createEip1193Provider(fakeConfig(), { defaultChainId: 8453 });
  await expect(p.request({ method: "eth_coinbase" })).rejects.toMatchObject({ code: 4200 });
});

test("state transitions emit connect / disconnect / accountsChanged off the injected subscribe", async () => {
  let acct: unknown = null;
  let up = false;
  let fire: () => void = () => {};
  const config = {
    connection: { account: () => acct, status: () => up },
  } as unknown as ClientConfig;
  const p = createEip1193Provider(config, {
    defaultChainId: 8453,
    subscribe: (l: () => void) => {
      fire = l;
      return () => {};
    },
  });

  const onConnect = vi.fn();
  const onDisconnect = vi.fn();
  const onAccounts = vi.fn();
  p.on("connect", onConnect);
  p.on("disconnect", onDisconnect);
  p.on("accountsChanged", onAccounts);

  // log in
  acct = { evm: { address: ADDR }, solana: { address: SOL } };
  up = true;
  fire();
  expect(onConnect).toHaveBeenCalledWith({ chainId: "0x2105" });
  expect(onAccounts).toHaveBeenLastCalledWith([ADDR]);

  // log out
  acct = null;
  up = false;
  fire();
  expect(onDisconnect).toHaveBeenCalledTimes(1);
  expect(onAccounts).toHaveBeenLastCalledWith([]);
});
