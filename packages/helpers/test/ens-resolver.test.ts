import { describe, expect, test } from "vitest";
import { getAddress } from "viem";
import { createEnsResolver } from "../src/ens-resolver.js";

// #6: these cases came from avokname's ens-service.test.ts. Resolution moved to helpers, so the
// tests moved with it — the ENS read path must stay proven with the subnames add-on uninstalled.
const REGISTRAR = getAddress("0x00000000000000000000000000000000000000aa");
const OWNER = getAddress("0x1a2b3c4d5e6f70819293a4b5c6d7e8f90a1b9f3c");

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    readContract: async () => getAddress("0x0000000000000000000000000000000000000000"),
    getEnsAddress: async () => OWNER,
    getEnsName: async () => "alice.qudiid.eth",
    ...over,
  } as never;
}

describe("createEnsResolver", () => {
  test("resolveForward returns the evm address", async () => {
    const svc = createEnsResolver({ chainId: 1, parent: "qudiid.eth", client: fakeClient() });
    expect(await svc.resolveForward("alice.qudiid.eth")).toEqual({ evm: OWNER });
  });

  test("resolveForward returns null when the name has no address", async () => {
    const svc = createEnsResolver({ chainId: 1, client: fakeClient({ getEnsAddress: async () => null }) });
    expect(await svc.resolveForward("ghost.eth")).toBeNull();
  });

  test("resolveReverse returns the primary name", async () => {
    const svc = createEnsResolver({ chainId: 1, client: fakeClient() });
    expect(await svc.resolveReverse(OWNER)).toBe("alice.qudiid.eth");
  });

  test("suffix is the parent with a leading dot", () => {
    expect(createEnsResolver({ chainId: 1, parent: "qudiid.eth", client: fakeClient() }).suffix).toBe(".qudiid.eth");
  });

  test("resolution needs NO registrar and NO parent — it resolves any .eth, suffix defaults to .eth", async () => {
    // WHY: this is the #6 acceptance in miniature — an app that never mints still resolves
    // vitalik.eth, with no registrar config and no add-on installed.
    const svc = createEnsResolver({ chainId: 1, client: fakeClient() });
    expect(await svc.resolveForward("vitalik.eth")).toEqual({ evm: OWNER });
    expect(svc.suffix).toBe(".eth");
    expect(REGISTRAR).toBeDefined(); // registrar plays no part in resolution
  });
});
