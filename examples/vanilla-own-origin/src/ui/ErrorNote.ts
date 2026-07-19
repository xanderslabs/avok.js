import { el } from "../core/el.js";
import type { SendErrorKind } from "@avokjs/core/helpers";

export function ErrorNote({ kind, message }: { kind: SendErrorKind; message: string }): HTMLElement {
  return el("div", { class: "error-note", role: "alert", "data-error-kind": kind }, message);
}
