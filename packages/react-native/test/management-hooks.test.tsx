import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { AvokProvider } from "../src/provider.js";
import { useEnroll, useExport, useAccessSlots } from "../src/hooks.js";
import type { FullAvokClient } from "@avokjs/core/engine";

// Parity with @avokjs/react's management-verb hooks: the RN hooks must delegate to the SAME client verbs
// and, crucially, remove() must update local state WITHOUT a second list gesture (re-decrypting every
// slot). Same fake-client contract as the react test, minus the DOM-render cases.

function makeFakeClient(): FullAvokClient {
  return {
    custody: "self" as const,
    subscribe: () => () => {},
    account: () => null,
    status: () => false,
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

const wrap = (client: FullAvokClient) => ({ children }: { children: ReactNode }) =>
  createElement(AvokProvider, { client, children });

describe("useEnroll", () => {
  it("delegates to client.enrollAccessSlot", async () => {
    const client = makeFakeClient();
    const { result } = renderHook(() => useEnroll(), { wrapper: wrap(client) });

    let r: unknown;
    await act(async () => { r = await result.current.enroll(); });
    expect(r).toMatchObject({ slotId: "0xslot", txId: "tx1", passkeyCount: 2 });
    expect(result.current.error).toBeNull();
  });
});

describe("useExport", () => {
  it("exportEvmKey / exportSolanaKey delegate to the client", async () => {
    const client = makeFakeClient();
    const { result } = renderHook(() => useExport(), { wrapper: wrap(client) });

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
    const { result } = renderHook(() => useAccessSlots(), { wrapper: wrap(client) });

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
    const { result } = renderHook(() => useAccessSlots(), { wrapper: wrap(client) });

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
