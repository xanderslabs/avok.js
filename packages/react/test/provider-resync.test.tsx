import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { AvokProvider, useAccount } from "../src/index.js";
import type { AvokClient } from "@avokjs/core";

afterEach(cleanup);

/** A minimal client seeded with a fixed address/status; no reactivity needed for this test. */
function seededClient(address: string | null, status: boolean): AvokClient {
  return {
    custody: "self" as const,
    subscribe: () => () => {},
    account: () => (address ? { evm: { address }, solana: { address: "x" } } : null),
    status: () => status,
    continue: async () => ({}),
    logout: () => {},
    read: {}, evm: {}, solana: {},
  } as unknown as AvokClient;
}

function View() {
  const { account, status } = useAccount();
  return <span>{`${account?.evm.address ?? "none"}|${status}`}</span>;
}

describe("AvokProvider resync on client prop change (PROV-1)", () => {
  it("reflects the new client's account/status when the client prop identity changes", () => {
    const clientA = seededClient("0xaaa", true);
    const clientB = seededClient(null, false);

    const { rerender } = render(
      <AvokProvider client={clientA}>
        <View />
      </AvokProvider>,
    );
    expect(screen.getByText("0xaaa|true")).toBeTruthy();

    rerender(
      <AvokProvider client={clientB}>
        <View />
      </AvokProvider>,
    );
    expect(screen.getByText("none|false")).toBeTruthy();
  });
});
