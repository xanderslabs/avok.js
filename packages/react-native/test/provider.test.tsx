/**
 * TDD Step 5 (brief): provider/useAccount test with a fake client.
 * Uses @testing-library/react (not RN runtime) since the provider/hooks
 * only import from `react` — no react-native dep needed to test them.
 */
import { render, screen, act, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { AvokClient } from "@avokjs/sdk-core";
import { AvokProvider, useAccount, useCreate } from "../src/index.js";

afterEach(cleanup);

// ─── Fake AvokClient ─────────────────────────────────────────────────────────

function makeFakeClient(): AvokClient {
  let _account: {
    evm: { address: `0x${string}`; subname?: string };
    solana: { address: string };
  } | null = null;
  let _status = false;
  // Model the real client's change-event contract: state-moving verbs notify subscribers.
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of listeners) l(); };
  const login = () => {
    _account = {
      evm: { address: "0x1111111111111111111111111111111111111111" },
      solana: { address: "So11111111111111111111111111111111111111" },
    };
    _status = true;
    notify();
    return _account;
  };

  return {
    custody: "self" as const,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    create: async (_o?: unknown) => login(),
    continue: async (_o?: unknown) => login(),
    import: async (_secret: unknown) => login(),
    export: async () => null,
    logout: () => {
      _account = null;
      _status = false;
      notify();
    },
    account: () => _account,
    status: () => _status,
    evm: {
      signMessage: async (_a: unknown) => "0xdeadbeef" as `0x${string}`,
      signTypedData: async (_a: unknown) => "0xdeadbeef" as `0x${string}`,
      signSiwe: async (_p: unknown) => ({
        message: "msg",
        signature: "0xdeadbeef" as `0x${string}`,
      }),
      simulate: async (_calls: unknown, _opts?: unknown) => ({}) as never,
      send: async (_input: unknown, _opts?: unknown) =>
        ({
          id: "0xtxhash",
          rail: "self-pay",
          status: "submitted",
          chainId: 1,
        }) as never,
    },
    read: {
      hasAccessSlot: async () => false,
      isDelegated: async (_chainId?: number) => false,
      passkeyCount: () => 0,
    },
  } as unknown as AvokClient;
}

// ─── useAccount ───────────────────────────────────────────────────────────────

describe("useAccount (native facade)", () => {
  it("reflects status=false initially", () => {
    const client = makeFakeClient();
    function View() {
      const { status } = useAccount();
      return <span>{String(status)}</span>;
    }
    render(
      <AvokProvider client={client}>
        <View />
      </AvokProvider>,
    );
    expect(screen.getByText("false")).toBeTruthy();
  });

  it("reflects status=true after create() called directly on client", async () => {
    const client = makeFakeClient();
    function View() {
      const { status } = useAccount();
      return <span>{String(status)}</span>;
    }
    render(
      <AvokProvider client={client}>
        <View />
      </AvokProvider>,
    );
    await act(() => client.create());
    expect(screen.getByText("true")).toBeTruthy();
  });

  it("reflects account address after create()", async () => {
    const client = makeFakeClient();
    function View() {
      const { account } = useAccount();
      return <span>{account?.evm.address ?? "none"}</span>;
    }
    render(
      <AvokProvider client={client}>
        <View />
      </AvokProvider>,
    );
    expect(screen.getByText("none")).toBeTruthy();
    await act(() => client.create());
    expect(screen.getByText("0x1111111111111111111111111111111111111111")).toBeTruthy();
  });

  it("resets to null/false after logout()", async () => {
    const client = makeFakeClient();
    function View() {
      const { status } = useAccount();
      return <span>{String(status)}</span>;
    }
    render(
      <AvokProvider client={client}>
        <View />
      </AvokProvider>,
    );
    await act(() => client.create());
    expect(screen.getByText("true")).toBeTruthy();
    await act(() => client.logout());
    expect(screen.getByText("false")).toBeTruthy();
  });
});

// ─── useCreate ───────────────────────────────────────────────────────────────

describe("useCreate (native facade)", () => {
  it("exposes error when client.create throws", async () => {
    const client = makeFakeClient();
    client.create = vi.fn().mockRejectedValue(new Error("passkey cancelled")) as never;

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client }, children);

    const { result } = renderHook(() => useCreate(), { wrapper });

    await act(async () => {
      await result.current.create().catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("passkey cancelled");
  });
});
