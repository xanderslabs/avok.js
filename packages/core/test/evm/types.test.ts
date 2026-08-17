import { expect, test } from "vitest";
import { railFromContext } from "../../src/evm/types.js";

test("railFromContext maps feeToken presence to a rail", () => {
  expect(railFromContext({ chainId: 10, feeToken: "0xabc0000000000000000000000000000000000000" })).toBe("sponsored");
  expect(railFromContext({ chainId: 10 })).toBe("native-gas");
  expect(railFromContext({ chainId: 10, feeToken: null })).toBe("native-gas");
});
