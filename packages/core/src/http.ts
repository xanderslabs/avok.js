/**
 * The minimal `fetch` shape the SDK needs — injectable so callers can supply a bound `globalThis.fetch`
 * or a test double. Deliberately structural (not the DOM `fetch` type) so it works in Node and the
 * browser without lib-dom, and so the SDK never depends on a global.
 *
 * Root-level and rail-neutral: both tx engines (the EVM bundler/paymaster inputs and the Solana Kora
 * client) and the client config take the SAME shape, so it is defined ONCE here rather than per rail.
 */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
