/**
 * The minimal `fetch` shape the SDK needs — injectable so callers can supply a bound `globalThis.fetch`
 * or a test double. Deliberately structural (not the DOM `fetch` type) so it works in Node and the
 * browser without lib-dom, and so the SDK never depends on a global.
 */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
