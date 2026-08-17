/**
 * provider/useAccount test with a fake client.
 * Uses @testing-library/react (not RN runtime) since the provider/hooks
 * only import from `react` — no react-native dep needed to test them.
 */
import { render, screen, act, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, it, expect } from "vitest";
import type { AvokClient } from "@avokjs/core";
import { AvokProvider, useAccount, useLogin } from "../src/index.js";

afterEach(cleanup);

// ─── Fake AvokClient ─────────────────────────────────────────────────────────

function makeFakeClient(): AvokClient {
  let _account: {
    evm: { address: `0x${string}` };
  } | null = null;
  let _status = false;
  // Model the real client's change-event contract: state-moving verbs notify subscribers.
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const login = () => {
    _account = {
      evm: { address: "0x1111111111111111111111111111111111111111" },
    };
    _status = true;
    notify();
    return _account;
  };

  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    login: async (_o?: unknown) => login(),
    logout: () => {
      _account = null;
      _status = false;
      notify();
    },
    account: () => _account,
    status: () => _status,
    isActivated: async () => false,
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

  it("reflects status=true after login() called directly on client", async () => {
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
    await act(() => client.login());
    expect(screen.getByText("true")).toBeTruthy();
  });

  it("reflects account address after login()", async () => {
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
    await act(() => client.login());
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
    await act(() => client.login());
    expect(screen.getByText("true")).toBeTruthy();
    await act(() => client.logout());
    expect(screen.getByText("false")).toBeTruthy();
  });
});

// ─── useLogin ───────────────────────────────────────────────────────────────

describe("useLogin (native facade)", () => {
  it("exposes error when client.login throws", async () => {
    const client = makeFakeClient();
    client.login = (() => Promise.reject(new Error("passkey cancelled"))) as never;

    const wrapper = ({ children }: { children: ReactNode }) => createElement(AvokProvider, { client }, children);

    const { result } = renderHook(() => useLogin(), { wrapper });

    await act(async () => {
      await result.current.login().catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("passkey cancelled");
  });
});
