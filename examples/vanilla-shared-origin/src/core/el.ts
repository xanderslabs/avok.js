/**
 * Tiny hyperscript DOM helper — the framework-free rendering primitive.
 *
 *   el("button", { class: "btn", onclick: fn, disabled: true }, "Send")
 *
 * - `class`     → className
 * - `style`     → object of camelCase CSS props applied onto element.style
 * - `on*` props → addEventListener(name-without-"on", handler)
 * - other props → set as element property when writable, else as attribute
 * - children    → strings/numbers become text nodes; arrays flatten one level;
 *                 null/undefined/false are skipped (so `cond && el(...)` works)
 */
export type ElChild = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | Record<string, string | number>;
  [key: string]: unknown;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function applyProps(node: Element, props: ElProps): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === "class") {
      node.setAttribute("class", String(value));
    } else if (key === "style" && typeof value === "object") {
      Object.assign((node as HTMLElement | SVGElement).style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in node) {
      // Writable DOM property (value, disabled, href, …).
      try {
        (node as unknown as Record<string, unknown>)[key] = value;
      } catch {
        node.setAttribute(key, String(value));
      }
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

function appendChildren(node: Element, children: (ElChild | ElChild[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps | null,
  ...children: (ElChild | ElChild[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) applyProps(node, props);
  appendChildren(node, children);
  return node;
}

/** SVG-namespaced variant for the Icon/BrandMark glyphs. */
export function svg(
  tag: string,
  props?: ElProps | null,
  ...children: (ElChild | ElChild[])[]
): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  if (props) applyProps(node, props);
  appendChildren(node, children);
  return node;
}
