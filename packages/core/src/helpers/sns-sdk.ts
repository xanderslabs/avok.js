// Typed shim over @solana-name-service/sns-sdk-kit.
//
// The published package (0.10.0-beta) is mis-typed for NodeNext consumers on two counts: its
// `exports["."]` lists the `import` (.mjs) condition before `types`, and its .d.ts barrels use
// extensionless `export *` re-exports that NodeNext will not follow. The runtime .mjs resolves
// fine everywhere (node + esbuild); only tsc type-resolution is broken. We import the namespace
// and re-type the two functions we use, verified against dist/types/*.d.ts at 0.10.0-beta:
//   resolveDomain({ rpc, domain })        => Promise<Address>            (throws if unregistered)
//   getPrimaryDomain({ rpc, walletAddress }) => Promise<{ domainName; domainAddress; stale }>
import * as snsSdk from "@solana-name-service/sns-sdk-kit";

/** The SDK's kit Rpc surface. Kept opaque here; the real Rpc is supplied at the wiring site. */
export type SnsRpc = unknown;

interface SnsSdk {
  resolveDomain(a: { rpc: SnsRpc; domain: string }): Promise<string>;
  getPrimaryDomain(a: {
    rpc: SnsRpc;
    walletAddress: string;
  }): Promise<{ domainName: string; domainAddress: string; stale: boolean }>;
}

const sdk = snsSdk as unknown as SnsSdk;

export const resolveDomain = sdk.resolveDomain;
export const getPrimaryDomain = sdk.getPrimaryDomain;
