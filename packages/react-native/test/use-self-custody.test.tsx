import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { AvokProvider } from "../src/provider.js";
import { useSelfCustody, useAvok } from "../src/hooks.js";
import type { ReactNode } from "react";

function client(custody: "self" | "use-only") {
  return { custody, account: () => null, status: () => false, logout: () => {},
    subscribe: () => () => {},
    continue: async () => ({}), create: async () => ({}), import: async () => ({}),
    export: async () => "0x", addPasskey: async () => ({ passkeyCount: 1 }),
    read: {}, evm: {}, solana: {} } as never;
}
// A use-only (shared-origin) client that STRUCTURALLY lacks create/import — mirrors
// what createAvokClient returns for a use-only (shared-origin) connection.
function useOnlyClient() {
  return { custody: "use-only", account: () => null, status: () => false, logout: () => {},
    subscribe: () => () => {},
    continue: async () => ({}), read: {}, evm: {}, solana: {} } as never;
}
const wrap = (c: unknown) => ({ children }: { children: ReactNode }) =>
  <AvokProvider client={c as never}>{children}</AvokProvider>;

describe("useSelfCustody", () => {
  it("returns the client for a self-custody (own-origin) client", () => {
    const { result } = renderHook(() => useSelfCustody(), { wrapper: wrap(client("self")) });
    expect(result.current.custody).toBe("self");
  });
  it("throws for a use-only (shared-origin) client", () => {
    expect(() => renderHook(() => useSelfCustody(), { wrapper: wrap(client("use-only")) })).toThrow();
  });
});

describe("AvokProvider tolerates use-only (shared-origin) clients", () => {
  it("mounts a client structurally lacking create/import without throwing", () => {
    const { result } = renderHook(() => useAvok(), { wrapper: wrap(useOnlyClient()) });
    expect(result.current.custody).toBe("use-only");
  });
});
