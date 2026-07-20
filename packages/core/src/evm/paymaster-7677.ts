import { http, type Address, type Transport } from "viem";
import {
  createPaymasterClient,
  entryPoint08Address,
  type GetPaymasterStubDataParameters,
  type GetPaymasterStubDataReturnType,
  type GetPaymasterDataParameters,
  type GetPaymasterDataReturnType,
} from "viem/account-abstraction";

/**
 * ERC-7677 paymaster client — the standard `pm_getPaymasterStubData` → `pm_getPaymasterData`
 * handshake. A thin, typed wrapper over
 * viem's `createPaymasterClient` so `sdk-core` never imports viem's account-abstraction surface
 * directly, and so the EntryPoint defaults to Avok's v0.8 target. The per-send fee token rides in
 * `context` and is forwarded to the RPC as the 4th ERC-7677 param.
 */
export interface Paymaster7677Options {
  /** ERC-7677 paymaster JSON-RPC endpoint (prod). Ignored when `transport` is supplied. */
  url?: string;
  /** Injectable viem transport — tests pass a `custom` transport; prod defaults to `http(url)`. */
  transport?: Transport;
  /** EntryPoint the paymaster serves; defaults to the v0.8 canonical singleton. */
  entryPointAddress?: Address;
}

// viem's paymaster params are a `OneOf<v0.6 | v0.7>` union; distribute the Omit so each branch keeps
// its mutually-exclusive fields (e.g. v0.7's `initCode: undefined`) rather than collapsing the union.
type WithOptionalEntryPoint<T> = T extends unknown
  ? Omit<T, "entryPointAddress"> & { entryPointAddress?: Address }
  : never;

/** viem's params minus a required `entryPointAddress` (defaulted by the client) — `context` carries the fee token. */
export type Paymaster7677StubParams = WithOptionalEntryPoint<GetPaymasterStubDataParameters>;
export type Paymaster7677DataParams = WithOptionalEntryPoint<GetPaymasterDataParameters>;

export interface Paymaster7677 {
  getPaymasterStubData(params: Paymaster7677StubParams): Promise<GetPaymasterStubDataReturnType>;
  getPaymasterData(params: Paymaster7677DataParams): Promise<GetPaymasterDataReturnType>;
}

export function createPaymaster7677(opts: Paymaster7677Options): Paymaster7677 {
  const transport = opts.transport ?? http(requireUrl(opts.url));
  const client = createPaymasterClient({ transport });
  const defaultEntryPoint = opts.entryPointAddress ?? entryPoint08Address;

  return {
    getPaymasterStubData: (params) =>
      client.getPaymasterStubData({
        ...params,
        entryPointAddress: params.entryPointAddress ?? defaultEntryPoint,
      }),
    getPaymasterData: (params) =>
      client.getPaymasterData({
        ...params,
        entryPointAddress: params.entryPointAddress ?? defaultEntryPoint,
      }),
  };
}

function requireUrl(url?: string): string {
  if (!url) throw new Error("createPaymaster7677: either `url` or `transport` is required");
  return url;
}
