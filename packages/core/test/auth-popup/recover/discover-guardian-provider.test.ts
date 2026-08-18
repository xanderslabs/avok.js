import { describe, expect, it, vi } from "vitest";
import {
  discoverInjectedProviders,
  connectGuardianWallet,
  type Eip6963Window,
} from "../../../src/auth-popup/recover/discover-guardian-provider.js";

/** A minimal fake of the EIP-6963 half of `window`: real `addEventListener`/`dispatchEvent` semantics
 *  (a request synchronously re-triggers every registered announce listener), no DOM. */
function fakeWindow(): Eip6963Window & { announceOne(detail: unknown): void } {
  const listeners = new Map<string, Set<(e: { detail: unknown }) => void>>();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn as (e: { detail: unknown }) => void);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn as (e: { detail: unknown }) => void);
    },
    dispatchEvent(event) {
      // `eip6963:requestProvider` carries no `detail` — real listeners for it (the announcer side)
      // ignore the argument entirely, same as here.
      for (const fn of listeners.get(event.type) ?? []) fn(event as unknown as { detail: unknown });
      return true;
    },
    announceOne(detail: unknown) {
      for (const fn of listeners.get("eip6963:announceProvider") ?? []) fn({ detail });
    },
  };
}

const PROVIDER_A = { request: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
const INFO_A = { uuid: "a", name: "Wallet A", icon: "data:image/svg+xml;base64,", rdns: "com.a" };

describe("discoverInjectedProviders", () => {
  it("requests announcement and collects providers that respond within the window", async () => {
    const win = fakeWindow();
    win.addEventListener("eip6963:requestProvider", () => {
      win.announceOne({ info: INFO_A, provider: PROVIDER_A });
    });
    const found = await discoverInjectedProviders(win, 5);
    expect(found).toEqual([{ info: INFO_A, provider: PROVIDER_A }]);
  });

  it("resolves an empty list when nothing announces (no extension installed)", async () => {
    const found = await discoverInjectedProviders(fakeWindow(), 5);
    expect(found).toEqual([]);
  });

  it("deduplicates by uuid — a provider that announces twice (ready + request) counts once", async () => {
    const win = fakeWindow();
    win.addEventListener("eip6963:requestProvider", () => {
      win.announceOne({ info: INFO_A, provider: PROVIDER_A });
      win.announceOne({ info: INFO_A, provider: PROVIDER_A });
    });
    const found = await discoverInjectedProviders(win, 5);
    expect(found).toHaveLength(1);
  });
});

describe("connectGuardianWallet", () => {
  it("connects the first discovered provider and returns a signTypedData closure", async () => {
    // request's return type varies by call (accounts array, then a signature string) — typed `unknown`
    // like the real Eip1193Provider so a later `mockResolvedValueOnce` isn't pinned to the first shape.
    const provider = {
      request: vi.fn<(args: { method: string; params?: unknown[] }) => Promise<unknown>>(async () => [
        "0x2222222222222222222222222222222222222222",
      ]),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const win = fakeWindow();
    win.addEventListener("eip6963:requestProvider", () => win.announceOne({ info: INFO_A, provider }));

    const conn = await connectGuardianWallet(win, 5);
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(conn.address).toBe("0x2222222222222222222222222222222222222222");

    provider.request.mockResolvedValueOnce("0xsignature");
    const sig = await conn.signTypedData({
      domain: {},
      types: {},
      primaryType: "RecoveryApproval",
      message: {},
    } as never);
    expect(sig).toBe("0xsignature");
    expect(provider.request).toHaveBeenLastCalledWith({
      method: "eth_signTypedData_v4",
      params: ["0x2222222222222222222222222222222222222222", expect.any(String)],
    });
  });

  it("throws a clear error when no injected wallet responds", async () => {
    await expect(connectGuardianWallet(fakeWindow(), 5)).rejects.toThrow(/no wallet/i);
  });

  it("throws when the connected provider returns no accounts", async () => {
    const provider = { request: vi.fn(async () => []), on: vi.fn(), removeListener: vi.fn() };
    const win = fakeWindow();
    win.addEventListener("eip6963:requestProvider", () => win.announceOne({ info: INFO_A, provider }));
    await expect(connectGuardianWallet(win, 5)).rejects.toThrow(/no account/i);
  });
});
