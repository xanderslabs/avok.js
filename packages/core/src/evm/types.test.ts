import { expect, test } from "vitest";
import { railFromContext } from "./types.js";

test("railFromContext maps feeToken presence to a rail", () => {
  expect(railFromContext({ chainId: 10, feeToken: "0xabc0000000000000000000000000000000000000" })).toBe("sponsored");
  expect(railFromContext({ chainId: 10 })).toBe("self-pay");
  expect(railFromContext({ chainId: 10, feeToken: null })).toBe("self-pay");
});
