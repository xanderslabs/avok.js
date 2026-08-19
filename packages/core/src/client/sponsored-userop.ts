import type { Address, Hex, SignedAuthorization } from "viem";
import {
  buildUserOp,
  getAvokUserOpHash,
  nativeGasFees,
  resolveEntryPoint,
  type AvokEntryPointVersion,
  type AvokUserOperation,
  type Bundler,
  type Call,
  type FeeBreakdown,
  type Paymaster7677,
  type PendingAuthorization,
  type RpcClient,
} from "../evm/index.js";

/** The bring-your-own 4337 infra a sponsored send routes through. */
export interface SponsoredInfra {
  rpc: RpcClient;
  bundler: Bundler;
  paymaster: Paymaster7677;
}

// A structurally-valid dummy 7702 authorization for GAS ESTIMATION of an undelegated account: the
// bundler needs the delegation designator (the `address`) so it simulates against the delegated
// account, but the single `signUserOp` gesture that produces the REAL signed tuple happens AFTER all
// IO (the key must never be live across a network round-trip). The userOpHash is independent of
// the authorization signature (verified), so this stub never changes the hash the wallet signs.
const STUB_R = ("0x" + "11".repeat(32)) as Hex;
const STUB_S = ("0x" + "22".repeat(32)) as Hex;
function stubAuthorization(a: PendingAuthorization): SignedAuthorization {
  return { chainId: a.chainId, address: a.address, nonce: a.nonce, r: STUB_R, s: STUB_S, yParity: 0 };
}

export interface PreparedSponsoredUserOp {
  /** The final UserOp: gas + paymaster sponsorship filled; `signature`/`authorization` still stubs. */
  op: AvokUserOperation;
  /** The hash the connection signs (already the EIP-712 digest `validateUserOp` checks), for whichever
   *  EntryPoint version this send targets. */
  userOpHash: Hex;
  chainId: number;
  /** The EntryPoint version `userOpHash` was computed against — the popup recomputes it from this,
   *  never trusting a caller-supplied hash, so it must know which singleton to check against. */
  entryPointVersion: AvokEntryPointVersion;
  /** The delegation to sign (undelegated account only) — passed to `connection.signUserOp`. */
  authorization?: PendingAuthorization;
}

/**
 * ALL IO, NO KEY. Reads the EntryPoint 2D nonce, runs the ERC-7677 handshake
 * (`getPaymasterStubData` → `estimateUserOperationGas` → `getPaymasterData`), and returns the final
 * unsigned UserOp plus its hash. Mirrors the key-isolation discipline of the native-gas path: every
 * network round-trip is done here, before the single `signUserOp` gesture.
 */
export async function prepareSponsoredUserOp(
  infra: SponsoredInfra,
  args: {
    sender: Address;
    calls: Call[];
    chainId: number;
    authorization?: PendingAuthorization;
    /** The paymaster `context` fee token; `null` ⇒ a single-token paymaster implies it (e.g. Circle USDC). */
    feeToken: Address | null;
    suggestedTip: bigint;
    baseFee: bigint;
    /** Which EntryPoint singleton to read the 2D nonce from and hash the UserOp against — MUST match
     *  what the target wallet's `ENTRY_POINT()` actually trusts (see `evm/entrypoint.ts`). */
    entryPointVersion: AvokEntryPointVersion;
  },
): Promise<PreparedSponsoredUserOp> {
  const { rpc, bundler, paymaster } = infra;
  const { sender, calls, chainId, authorization, feeToken, entryPointVersion } = args;
  const fees = nativeGasFees(args.suggestedTip, args.baseFee);
  const auth = authorization ? stubAuthorization(authorization) : undefined;
  const context = feeToken ? { token: feeToken } : undefined;
  const entryPoint = resolveEntryPoint(entryPointVersion);

  const nonce = await rpc.readContract<bigint>({
    address: entryPoint.address,
    abi: entryPoint.abi,
    functionName: "getNonce",
    args: [sender, 0n],
  });

  const base = { sender, calls, chainId, nonce, fees, ...(auth ? { authorization: auth } : {}) };

  const stub = await paymaster.getPaymasterStubData({
    ...buildUserOp(base),
    chainId,
    ...(context ? { context } : {}),
  } as Parameters<Paymaster7677["getPaymasterStubData"]>[0]);
  const stubPaymaster = stub as {
    paymaster: Address;
    paymasterData: Hex;
    paymasterVerificationGasLimit?: bigint;
    paymasterPostOpGasLimit?: bigint;
  };
  const pmStubFields = {
    paymaster: stubPaymaster.paymaster,
    paymasterData: stubPaymaster.paymasterData,
    ...(stubPaymaster.paymasterVerificationGasLimit !== undefined
      ? { paymasterVerificationGasLimit: stubPaymaster.paymasterVerificationGasLimit }
      : {}),
    ...(stubPaymaster.paymasterPostOpGasLimit !== undefined
      ? { paymasterPostOpGasLimit: stubPaymaster.paymasterPostOpGasLimit }
      : {}),
  };

  const gas = await bundler.estimateUserOperationGas(buildUserOp({ ...base, paymaster: pmStubFields }));
  const gasFields = {
    callGasLimit: gas.callGasLimit,
    verificationGasLimit: gas.verificationGasLimit,
    preVerificationGas: gas.preVerificationGas,
  };

  const withGas = buildUserOp({ ...base, gas: gasFields, paymaster: pmStubFields });
  const data = (await paymaster.getPaymasterData({
    ...withGas,
    chainId,
    ...(context ? { context } : {}),
  } as Parameters<Paymaster7677["getPaymasterData"]>[0])) as { paymaster: Address; paymasterData: Hex };

  const op = buildUserOp({
    ...base,
    gas: gasFields,
    paymaster: {
      paymaster: data.paymaster,
      paymasterData: data.paymasterData,
      paymasterVerificationGasLimit: gas.paymasterVerificationGasLimit ?? stubPaymaster.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: gas.paymasterPostOpGasLimit ?? stubPaymaster.paymasterPostOpGasLimit,
    },
  });
  return {
    op,
    userOpHash: getAvokUserOpHash(op, chainId, entryPointVersion),
    chainId,
    entryPointVersion,
    authorization,
  };
}

/** Every gas limit the UserOp commits — the ceiling `maxFeePerGas` is charged against. */
function totalGasUnits(op: AvokUserOperation): bigint {
  return (
    op.callGasLimit +
    op.verificationGasLimit +
    op.preVerificationGas +
    (op.paymasterVerificationGasLimit ?? 0n) +
    (op.paymasterPostOpGasLimit ?? 0n)
  );
}

/**
 * The BOUNDED gas cost a sponsored UserOp commits — sign-what-you-saw: derived from the SIGNED op's
 * gas limits × `maxFeePerGas` (the ceiling the signature authorises). Post-oracle this is the raw gas
 * ceiling in the chain's NATIVE units; no USD conversion is applied (the oracle is retired, and the
 * ERC-7677 response carries no token amount). `feeToken` labels the token the paymaster sponsors in.
 * A paymaster's own premium (e.g. Circle's 10%) rides on top and is not expressible from the ERC-7677
 * response, so it is not folded in here. When the fee token is unknown (a single-token paymaster), the
 * caller shows no amount rather than calling this — disclose none, exactly as before.
 */
export function boundedSponsoredFee(op: AvokUserOperation, feeToken: Address): FeeBreakdown {
  const gasUnits = totalGasUnits(op);
  const gasPrice = op.maxFeePerGas; // the committed ceiling
  return { feeToken, amount: gasUnits * gasPrice, gasUnits, gasPrice };
}
