import { describe, it, expect } from "vitest";
import { memoryStorage } from "../../src/storage.js";

describe("memoryStorage", () => {
  it("round-trips and removes", async () => {
    const s = memoryStorage();
    expect(await s.get("k")).toBeNull();
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
    await s.remove("k");
    expect(await s.get("k")).toBeNull();
  });
});
