import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { UseOnlyAvokClient } from "@avokjs/core";
import { AvokProvider } from "./provider.js";
import { useAvokConnect, operatorNameFromOrigin } from "./connect.js";

afterEach(cleanup);

function fakeClient(login: () => Promise<unknown>): UseOnlyAvokClient {
  return {
    login,
    account: () => null,
    status: () => false,
    subscribe: () => () => {},
    custody: "use-only",
  } as unknown as UseOnlyAvokClient;
}

const wrap = (client: UseOnlyAvokClient) => ({ children }: { children: ReactNode }) => (
  <AvokProvider client={client}>{children}</AvokProvider>
);

describe("operatorNameFromOrigin", () => {
  it("returns the hostname of an origin", () => {
    expect(operatorNameFromOrigin("https://auth.acme.com")).toBe("auth.acme.com");
  });
  it("falls back to the raw string for a non-URL", () => {
    expect(operatorNameFromOrigin("not a url")).toBe("not a url");
  });
});

describe("useAvokConnect", () => {
  it("connect() calls client.login and clears pending afterwards", async () => {
    const login = vi.fn().mockResolvedValue({ evm: { address: "0x1" }, solana: { address: "sol" } });
    const { result } = renderHook(() => useAvokConnect(), { wrapper: wrap(fakeClient(login)) });

    expect(result.current.isPending).toBe(false);
    await act(async () => {
      await result.current.connect();
    });
    expect(login).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a login failure as error and rethrows", async () => {
    const login = vi.fn().mockRejectedValue(new Error("popup closed"));
    const { result } = renderHook(() => useAvokConnect(), { wrapper: wrap(fakeClient(login)) });

    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow("popup closed");
    });
    expect(result.current.error?.message).toBe("popup closed");
    expect(result.current.isPending).toBe(false);
  });
});
