import { expect, test } from "vitest";
import { isDelegatedTo } from "../../src/evm/resolve.js";

const IMPL = "0x000000000000000000000000000000000000abcd" as const;

test("isDelegatedTo matches the 0xef0100‖impl designator", () => {
  expect(isDelegatedTo(("0xef0100" + IMPL.slice(2)) as `0x${string}`, IMPL)).toBe(true);
  expect(isDelegatedTo("0x", IMPL)).toBe(false);
});
