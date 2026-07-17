// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { announceEip6963 } from "../src/eip6963.js";
import type { Eip1193Provider } from "../src/eip1193.js";

const provider = { request: async () => null, on: () => {}, removeListener: () => {} } as Eip1193Provider;
const info = { uuid: "550e8400-e29b-41d4-a716-446655440000", name: "Avok", icon: "data:image/svg+xml;base64,x", rdns: "com.avok" };

test("announce fires once immediately on call", () => {
  const seen = vi.fn();
  window.addEventListener("eip6963:announceProvider", seen);
  const cleanup = announceEip6963(provider, info);
  expect(seen).toHaveBeenCalledTimes(1);
  const evt = seen.mock.calls[0][0] as CustomEvent;
  expect(evt.detail).toEqual({ info, provider });
  window.removeEventListener("eip6963:announceProvider", seen);
  cleanup();
});

test("answers eip6963:requestProvider with an announce carrying { info, provider }", () => {
  const seen = vi.fn();
  window.addEventListener("eip6963:announceProvider", seen);
  const cleanup = announceEip6963(provider, info);
  seen.mockClear(); // ignore the immediate announce
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  expect(seen).toHaveBeenCalledTimes(1);
  expect((seen.mock.calls[0][0] as CustomEvent).detail).toEqual({ info, provider });
  window.removeEventListener("eip6963:announceProvider", seen);
  cleanup();
});

test("the announced detail is frozen (EIP-6963)", () => {
  const seen = vi.fn();
  window.addEventListener("eip6963:announceProvider", seen);
  const cleanup = announceEip6963(provider, info);
  const detail = (seen.mock.calls[0][0] as CustomEvent).detail;
  expect(Object.isFrozen(detail)).toBe(true);
  window.removeEventListener("eip6963:announceProvider", seen);
  cleanup();
});

test("cleanup stops answering requestProvider", () => {
  const seen = vi.fn();
  const cleanup = announceEip6963(provider, info);
  window.addEventListener("eip6963:announceProvider", seen);
  cleanup();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  expect(seen).not.toHaveBeenCalled();
  window.removeEventListener("eip6963:announceProvider", seen);
});
