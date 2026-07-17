import { describe, it, expect, vi } from "vitest";
import { createStore } from "../src/core/store.js";

describe("createStore", () => {
  it("merges partial state and notifies subscribers", () => {
    const s = createStore({ nav: "home", n: 0 });
    const seen: number[] = [];
    s.subscribe((st) => seen.push(st.n));
    s.setState({ n: 1 });
    s.setState((st) => ({ n: st.n + 1 }));
    expect(s.getState()).toEqual({ nav: "home", n: 2 });
    expect(seen).toEqual([1, 2]);
  });

  it("unsubscribe stops notifications", () => {
    const s = createStore({ n: 0 });
    const fn = vi.fn();
    const off = s.subscribe(fn);
    off();
    s.setState({ n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
});
