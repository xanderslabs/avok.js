/**
 * The account-lifecycle hooks and provider resync, mirroring @avokjs/react's coverage.
 *
 * RN's hooks.ts and provider.tsx are near-copies of the react package's — same bodies, different
 * import specifier — kept separate so this graph never pulls DOM/web-React. Copies drift, and until
 * now only react's copy was tested for `useLogin`, `useLogout` and the client-prop resync (PROV-1).
 * The native copy could have diverged in any of the three without a single test noticing.
 *
 * These deliberately mirror react/test/hooks.test.tsx and react/test/provider-resync.test.tsx so the
 * two suites can be diffed against each other, which is the cheapest way to spot a real divergence.
 * @testing-library/react is used, not an RN runtime: provider and hooks only import from `react`.
 */
import { render, screen, act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, it, expect } from "vitest";
import type { FullAvokClient } from "@avokjs/core";
import { AvokProvider, useAccount, useLogin, useLogout } from "../src/index.js";

afterEach(cleanup);

const ADDRESS = "0x1111111111111111111111111111111111111111";

function makeFakeClient(): FullAvokClient {
  let account: { evm: { address: string }; solana: { address: string } } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  return {
    custody: "self" as const,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    account: () => account,
    status: () => account !== null,
    login: async () => {
      account = { evm: { address: ADDRESS }, solana: { address: "So1111111111111111111111111111111" } };
      notify();
      return account;
    },
    logout: () => {
      account = null;
      notify();
    },
  } as unknown as FullAvokClient;
}

const wrapperFor = (client: FullAvokClient) => {
  return ({ children }: { children: ReactNode }) => createElement(AvokProvider, { client, children });
};

describe("useLogin (native)", () => {
  it("delegates to client.login and returns the Account", async () => {
    const client = makeFakeClient();
    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(client) });
    expect(result.current.pending).toBe(false);

    let account: unknown;
    await act(async () => {
      account = await result.current.login();
    });

    expect(account).toMatchObject({ evm: { address: ADDRESS } });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("exposes pending=true while login is in flight", async () => {
    // The RN facade's whole error/pending contract exists so a failed or slow passkey gesture
    // surfaces where it is rendered, rather than as an unhandled rejection.
    let resolve!: (v: unknown) => void;
    const client = makeFakeClient();
    client.login = (() =>
      new Promise((res) => {
        resolve = res;
      })) as never;

    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(client) });

    let p!: Promise<unknown>;
    act(() => {
      p = result.current.login();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolve({ evm: { address: ADDRESS } });
      await p;
    });
    expect(result.current.pending).toBe(false);
  });

  it("surfaces a rejected login as `error`, not as a thrown rejection", async () => {
    const client = makeFakeClient();
    client.login = (async () => {
      throw new Error("user cancelled the passkey prompt");
    }) as never;

    const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.login().catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.pending).toBe(false);
  });
});

describe("useLogout (native)", () => {
  it("tolerates the synchronous void return of client.logout", async () => {
    // logout is sync-void on this client and async on others; the hook must not assume a promise.
    const client = makeFakeClient();
    const { result } = renderHook(() => useLogout(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("exposes pending=true while an async logout is in flight", async () => {
    let resolve!: () => void;
    const client = makeFakeClient();
    client.logout = (() =>
      new Promise<void>((res) => {
        resolve = res;
      })) as never;

    const { result } = renderHook(() => useLogout(), { wrapper: wrapperFor(client) });

    let p!: Promise<unknown>;
    act(() => {
      p = result.current.logout();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolve();
      await p;
    });
    expect(result.current.pending).toBe(false);
  });
});

/** Seeded, non-reactive client — resync is about the PROP changing, not about subscriptions firing. */
function seededClient(address: string | null): FullAvokClient {
  return {
    custody: "self" as const,
    subscribe: () => () => {},
    account: () => (address ? { evm: { address }, solana: { address: "x" } } : null),
    status: () => address !== null,
    login: async () => ({}),
    logout: () => {},
  } as unknown as FullAvokClient;
}

function View() {
  const { account, status } = useAccount();
  return <span>{`${account?.evm.address ?? "none"}|${status}`}</span>;
}

describe("AvokProvider resync on client prop change (PROV-1, native)", () => {
  it("reflects the new client's account/status when the client identity changes", () => {
    // An app that swaps the client — logging out into a fresh instance, or switching operator —
    // must not keep rendering the previous client's account. react covers this; the native copy of
    // the provider carries the same resync effect and was untested.
    const { rerender } = render(
      <AvokProvider client={seededClient("0xaaa")}>
        <View />
      </AvokProvider>,
    );
    expect(screen.getByText("0xaaa|true")).toBeTruthy();

    rerender(
      <AvokProvider client={seededClient(null)}>
        <View />
      </AvokProvider>,
    );
    expect(screen.getByText("none|false")).toBeTruthy();
  });
});
