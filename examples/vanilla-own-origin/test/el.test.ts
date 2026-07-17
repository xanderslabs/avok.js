import { describe, it, expect, vi } from "vitest";
import { el } from "../src/core/el.js";

describe("el", () => {
  it("sets class, style, text child", () => {
    const node = el("div", { class: "card", style: { color: "red" } }, "hi");
    expect(node.className).toBe("card");
    expect(node.style.color).toBe("red");
    expect(node.textContent).toBe("hi");
  });

  it("binds events and flattens/skips children", () => {
    const onclick = vi.fn();
    const node = el("button", { onclick }, ["a", null, 1, false]);
    node.click();
    expect(onclick).toHaveBeenCalledOnce();
    expect(node.textContent).toBe("a1");
  });

  it("sets writable DOM properties like disabled", () => {
    const node = el("button", { disabled: true }, "x");
    expect((node as HTMLButtonElement).disabled).toBe(true);
  });
});
