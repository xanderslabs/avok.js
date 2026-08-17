/**
 * Self-custody invariant: the shared-origin `Connection` (the one custody posture every app gets,
 * D3: popup-for-all) has NO verb that could return key material. There is nothing to gate at
 * runtime beyond the type boundary — this test proves the boundary is real by checking the object
 * that comes back from a live connect() literally carries none of those members.
 */
import { describe, it, expect } from "vitest";
import { createSharedOriginConnection } from "../../src/shared-origin/connection.js";
import { makeFakeChannel } from "../client/fakes.js";

describe("self-custody invariant — shared-origin connection", () => {
  it("has NO custody-management verbs — no path to key material", async () => {
    const channel = makeFakeChannel();
    const conn = createSharedOriginConnection({
      originPoint: "https://auth.qudi.fi",
      channel,
    });
    await conn.continue();

    // The custody boundary is enforced at the type level; assert it at runtime too. A connection
    // that literally has no export/addPasskey/create member cannot leak key material — there is no
    // surface through which it could.
    for (const verb of ["export", "addPasskey", "create"]) {
      expect(verb in conn).toBe(false);
    }
  });
});
