import { http, type Address, type Hash, type Hex, type Transport } from "viem";
import {
  createBundlerClient,
  UserOperationReceiptNotFoundError,
  type EstimateUserOperationGasReturnType,
  type UserOperation,
  type UserOperationReceipt,
} from "viem/account-abstraction";
import { resolveEntryPoint, DEFAULT_ENTRY_POINT_VERSION, type AvokEntryPointVersion } from "./entrypoint.js";

/**
 * ERC-4337 bundler client — submits and tracks fully-built UserOperations. A thin wrapper over viem's
 * `createBundlerClient` that sends the raw (already-signed) UserOp directly (no viem SmartAccount
 * preparation), so the Avok `Connection`/`userop.ts` stays the single source of the UserOp and its
 * signature. Passes the EntryPoint explicitly since there is no viem account to derive it from.
 */
export interface BundlerOptions {
  /** ERC-4337 bundler JSON-RPC endpoint (prod). Ignored when `transport` is supplied. */
  url?: string;
  /** Injectable viem transport — tests pass a `custom` transport; prod defaults to `http(url)`. */
  transport?: Transport;
  /** EntryPoint the bundler serves; defaults to resolving from `entryPointVersion`. Set this directly
   *  only to point at a non-canonical deployment (e.g. a test fixture). */
  entryPointAddress?: Address;
  /** Which EntryPoint version this bundler serves — see `entrypoint.ts`. Defaults to
   *  `DEFAULT_ENTRY_POINT_VERSION` ("0.8", what every AvokCalibur wallet trusts out of the box).
   *  Ignored when `entryPointAddress` is set explicitly. */
  entryPointVersion?: AvokEntryPointVersion;
}

/** A fully-built UserOperation ready to estimate/submit, for whichever EntryPoint version the caller
 *  configured (see `entrypoint.ts`'s `AvokEntryPointVersion`). */
export type AvokUserOperation = UserOperation<AvokEntryPointVersion>;

export interface Bundler {
  estimateUserOperationGas(userOp: AvokUserOperation): Promise<EstimateUserOperationGasReturnType>;
  /** Submits the signed UserOp; returns its userOpHash. */
  sendUserOperation(userOp: AvokUserOperation): Promise<Hex>;
  /** The receipt once mined, or `null` while the UserOp is still pending. */
  getUserOperationReceipt(hash: Hash): Promise<UserOperationReceipt | null>;
}

export function createBundler(opts: BundlerOptions): Bundler {
  const transport = opts.transport ?? http(requireUrl(opts.url));
  const client = createBundlerClient({ transport });
  const entryPointAddress =
    opts.entryPointAddress ?? resolveEntryPoint(opts.entryPointVersion ?? DEFAULT_ENTRY_POINT_VERSION).address;

  return {
    estimateUserOperationGas: (userOp) =>
      client.estimateUserOperationGas({ ...userOp, entryPointAddress } as Parameters<
        typeof client.estimateUserOperationGas
      >[0]),
    sendUserOperation: (userOp) =>
      client.sendUserOperation({ ...userOp, entryPointAddress } as Parameters<typeof client.sendUserOperation>[0]),
    getUserOperationReceipt: async (hash) => {
      try {
        return await client.getUserOperationReceipt({ hash });
      } catch (err) {
        if (err instanceof UserOperationReceiptNotFoundError) return null;
        throw err;
      }
    },
  };
}

function requireUrl(url?: string): string {
  if (!url) throw new Error("createBundler: either `url` or `transport` is required");
  return url;
}
