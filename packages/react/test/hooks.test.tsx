import { render, screen, act, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  AvokProvider,
  useAccount,
  useCreate,
  useLogin,
  useLogout,
} from "../src/index.js";
import type { AvokClient } from "@avokjs/sdk-core";

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
    login: async (_o?: unknown) => login(),
    logout: () => {
      _account = null;
      _status = false;
      notify();
    },
    account: () => _account,
    status: () => _status,
  } as unknown as AvokClient;
}

// ─── useAccount reflects status after create() ───────────────────────────────

describe("useAccount", () => {
  it("reflects status after create() called directly on client", async () => {
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

// ─── useLogin ─────────────────────────────────────────────────────────────────

describe("useLogin", () => {
  it("delegates to client.login and returns Account", async () => {
    const client = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });

    const { result } = renderHook(() => useLogin(), { wrapper });
    expect(result.current.pending).toBe(false);

    let account: unknown;
    await act(async () => {
      account = await result.current.login();
    });

    expect(account).toMatchObject({ evm: { address: "0x1111111111111111111111111111111111111111" } });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("exposes pending=true while client.login is running", async () => {
    let resolve!: (v: unknown) => void;
    const client = makeFakeClient();
    client.login = (() => new Promise((res) => { resolve = res; })) as never;

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });
    const { result } = renderHook(() => useLogin(), { wrapper });

    let p!: Promise<unknown>;
    act(() => { p = result.current.login(); });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolve({ evm: { address: "0x1111111111111111111111111111111111111111" } });
      await p;
    });
    expect(result.current.pending).toBe(false);
  });
});

// ─── useLogout ───────────────────────────────────────────────────────────────

describe("useLogout", () => {
  it("delegates to client.logout (sync-void) without throwing", async () => {
    const client = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });

    const { result } = renderHook(() => useLogout(), { wrapper });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();

    // client.logout() returns void (synchronous) — useLogout must not throw.
    await act(async () => { await result.current.logout(); });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("exposes pending=true while logout is running (async path)", async () => {
    let resolve!: () => void;
    const client = makeFakeClient();
    client.logout = (() => new Promise<void>((res) => { resolve = res; })) as never;

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });
    const { result } = renderHook(() => useLogout(), { wrapper });

    let p!: Promise<unknown>;
    act(() => { p = result.current.logout(); });
    expect(result.current.pending).toBe(true);

    await act(async () => { resolve(); await p; });
    expect(result.current.pending).toBe(false);
  });
});

// ─── useCreate error path ────────────────────────────────────────────────────

describe("useCreate", () => {
  it("exposes error when client.create throws", async () => {
    const client = makeFakeClient();
    client.create = vi.fn().mockRejectedValue(new Error("passkey cancelled")) as never;

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });

    const { result } = renderHook(() => useCreate(), { wrapper });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.create().catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("passkey cancelled");
    expect(result.current.pending).toBe(false);
  });

  it("returns Account on success and clears error", async () => {
    const client = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });

    const { result } = renderHook(() => useCreate(), { wrapper });

    let account: unknown;
    await act(async () => {
      account = await result.current.create();
    });

    expect(account).toMatchObject({ evm: { address: "0x1111111111111111111111111111111111111111" } });
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });
});
