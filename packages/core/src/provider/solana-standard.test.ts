import { expect, test, vi, beforeEach } from "vitest";
import type { Wallet } from "@wallet-standard/base";
import type { ClientConfig } from "../index.js";
import type { SolanaEngine } from "../internal/index.js";

// Capture the wallet handed to registerWallet.
const registered: Wallet[] = [];
vi.mock("@wallet-standard/wallet", () => ({
  registerWallet: (w: Wallet) => registered.push(w),
}));

import { registerAvokSolanaWallet } from "./solana-standard.js";

const ADDR = "So11111111111111111111111111111111111111112"; // valid base58 (wSOL mint)
const PUBKEY = new Uint8Array(32).fill(7);

function fakeEngine(over: Partial<SolanaEngine> = {}): SolanaEngine {
  return {
    account: over.account ?? (() => ({ address: ADDR, publicKey: PUBKEY })),
    signMessage: over.signMessage ?? vi.fn(),
    signTransaction: over.signTransaction ?? vi.fn(),
    signAndSend: over.signAndSend ?? vi.fn(),
  };
}

const config = { connection: {} } as unknown as ClientConfig;

beforeEach(() => {
  registered.length = 0;
});

test("registers a Wallet Standard wallet with the Solana feature set", () => {
  registerAvokSolanaWallet(config, { engine: fakeEngine() });
  expect(registered).toHaveLength(1);
  const w = registered[0];
  expect(w.version).toBe("1.0.0");
  expect(w.chains).toEqual(expect.arrayContaining(["solana:mainnet", "solana:devnet"]));
  expect(Object.keys(w.features)).toEqual(
    expect.arrayContaining([
      "standard:connect",
      "standard:disconnect",
      "standard:events",
      "solana:signMessage",
      "solana:signTransaction",
      "solana:signAndSendTransaction",
    ]),
  );
});

test("accounts reflect the connection's active Solana account", () => {
  registerAvokSolanaWallet(config, { engine: fakeEngine() });
  const w = registered[0];
  expect(w.accounts).toHaveLength(1);
  expect(w.accounts[0].address).toBe(ADDR);
  expect(w.accounts[0].publicKey).toEqual(PUBKEY);
  expect(w.accounts[0].chains).toEqual(expect.arrayContaining(["solana:mainnet"]));
});

test("no accounts when logged out", () => {
  registerAvokSolanaWallet(config, { engine: fakeEngine({ account: () => null }) });
  expect(registered[0].accounts).toEqual([]);
});

test("solana:signMessage delegates to the engine", async () => {
  const signMessage = vi.fn().mockResolvedValue({ signedMessage: new Uint8Array([1]), signature: new Uint8Array([2]) });
  registerAvokSolanaWallet(config, { engine: fakeEngine({ signMessage }) });
  const feature = registered[0].features["solana:signMessage"] as {
    signMessage(input: { account: unknown; message: Uint8Array }): Promise<unknown[]>;
  };
  const msg = new Uint8Array([9, 9]);
  const out = await feature.signMessage({ account: registered[0].accounts[0], message: msg });
  expect(signMessage).toHaveBeenCalledWith(msg);
  expect(out).toEqual([{ signedMessage: new Uint8Array([1]), signature: new Uint8Array([2]) }]);
});

test("solana:signAndSendTransaction delegates to the engine and returns { signature }", async () => {
  const signAndSend = vi.fn().mockResolvedValue(new Uint8Array([5, 5]));
  registerAvokSolanaWallet(config, { engine: fakeEngine({ signAndSend }) });
  const feature = registered[0].features["solana:signAndSendTransaction"] as {
    signAndSendTransaction(input: { account: unknown; transaction: Uint8Array; chain: string }): Promise<unknown[]>;
  };
  const wire = new Uint8Array([1, 2, 3]);
  const out = await feature.signAndSendTransaction({ account: registered[0].accounts[0], transaction: wire, chain: "solana:devnet" });
  expect(signAndSend).toHaveBeenCalledWith(wire, "devnet");
  expect(out).toEqual([{ signature: new Uint8Array([5, 5]) }]);
});

test("returns an unregister disposer", () => {
  const off = registerAvokSolanaWallet(config, { engine: fakeEngine() });
  expect(typeof off).toBe("function");
});
