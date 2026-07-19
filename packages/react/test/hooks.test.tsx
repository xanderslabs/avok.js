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
  useEnroll,
  useExport,
  useAccessSlots,
} from "../src/index.js";
import type { FullAvokClient } from "@avokjs/core";

afterEach(cleanup);

// ─── Fake FullAvokClient ─────────────────────────────────────────────────────────

function makeFakeClient(): FullAvokClient {
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
    // Management verbs — defaults; individual tests override with spies where they assert call counts.
    enrollAccessSlot: async () => ({ slotId: "0xslot", txId: "tx1", passkeyCount: 2 }),
    exportEvmKey: async () => "0xevmkey",
    exportSolanaKey: async () => "0xsolkey",
    listAccessSlots: async () => [
      { slotId: "0xaaa", addedAt: 1, encryptedMeta: new Uint8Array(), isThisDevice: true, rpId: "example.com" },
    ],
    accessSlotCount: async () => 1,
    removeAccessSlot: async (_slotId: string, _opts: { confirm: true }) => ({ txId: "txrm" }),
  } as unknown as FullAvokClient;
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

// ─── Management-verb hooks ─────────────────────────────────────────────────────

describe("useEnroll", () => {
  it("delegates to client.enrollAccessSlot", async () => {
    const client = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });
    const { result } = renderHook(() => useEnroll(), { wrapper });

    let r: unknown;
    await act(async () => { r = await result.current.enroll(); });
    expect(r).toMatchObject({ slotId: "0xslot", txId: "tx1", passkeyCount: 2 });
    expect(result.current.error).toBeNull();
  });
});

describe("useExport", () => {
  it("exportEvmKey / exportSolanaKey delegate to the client", async () => {
    const client = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });
    const { result } = renderHook(() => useExport(), { wrapper });

    let evm: unknown, sol: unknown;
    await act(async () => {
      evm = await result.current.exportEvmKey();
      sol = await result.current.exportSolanaKey();
    });
    expect(evm).toBe("0xevmkey");
    expect(sol).toBe("0xsolkey");
    expect(result.current.error).toBeNull();
  });
});

describe("useAccessSlots", () => {
  it("slots/count are null until refresh(), then populated", async () => {
    const client = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });
    const { result } = renderHook(() => useAccessSlots(), { wrapper });

    expect(result.current.slots).toBeNull();
    expect(result.current.count).toBeNull();

    await act(async () => { await result.current.refresh(); });
    expect(result.current.count).toBe(1);
    expect(result.current.slots).toHaveLength(1);
    expect(result.current.slots?.[0].rpId).toBe("example.com");
  });

  it("remove() drops the slot locally + decrements count WITHOUT a second list gesture", async () => {
    const client = makeFakeClient();
    // Two slots; spy on listAccessSlots so we can prove remove() does not re-list.
    const listSpy = vi.fn(async () => [
      { slotId: "0xaaa", addedAt: 1, encryptedMeta: new Uint8Array(), isThisDevice: true, rpId: "a" },
      { slotId: "0xbbb", addedAt: 2, encryptedMeta: new Uint8Array(), isThisDevice: false, rpId: "b" },
    ]);
    client.listAccessSlots = listSpy as never;
    client.accessSlotCount = (async () => 2) as never;
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AvokProvider, { client, children });
    const { result } = renderHook(() => useAccessSlots(), { wrapper });

    await act(async () => { await result.current.refresh(); });
    expect(result.current.count).toBe(2);

    await act(async () => { await result.current.remove("0xaaa" as never, { confirm: true }); });
    expect(result.current.count).toBe(1);
    expect(result.current.slots).toHaveLength(1);
    expect(result.current.slots?.[0].slotId).toBe("0xbbb");
    // The point: removal is ONE gesture. Re-listing would decrypt every slot again — it must not happen.
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});
