import type { Address, Hex, SignedAuthorization } from "viem";
import {
  getUserOperationHash,
  entryPoint08Abi,
  entryPoint08Address,
  toSmartAccount,
  type SmartAccount,
  type SmartAccountImplementation,
  type UserOperation,
} from "viem/account-abstraction";
import type { Call } from "../wallet/index.js";
import { encodeExecuteBatch } from "./sim-methods.js";
import type { AvokUserOperation } from "./bundler.js";

/**
 * The signing seam `sdk-core`'s `Connection` provides (wired in Task 9). Both signatures come from
 * the SAME passkey gesture as today's composite `signSponsored`: `signUserOpHash` is the ecrecover
 * signature the contract's `validateUserOp` checks; `signAuthorization` is the EIP-7702 delegation
 * tuple attached to the first (undelegated) sponsored send.
 */
export interface UserOpSigner {
  signUserOpHash(userOpHash: Hex): Promise<Hex>;
  signAuthorization(auth: { chainId: number; address: Address; nonce: number }): Promise<SignedAuthorization>;
}

export interface BuildUserOpArgs {
  sender: Address;
  calls: readonly Call[];
  chainId: number;
  /** EntryPoint 2D nonce (the 4337 nonce space — distinct from the contract's self-pay `nonceBitmap`). */
  nonce: bigint;
  fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  /** Filled after `estimateUserOperationGas`; 0 during the stub/estimate phase. */
  gas?: { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint };
  paymaster?: {
    paymaster: Address;
    paymasterData: Hex;
    paymasterVerificationGasLimit?: bigint;
    paymasterPostOpGasLimit?: bigint;
  };
  /**
   * The EIP-7702 authorization for an undelegated account's first sponsored send. Attached to the UserOp
   * (viem forwards it as `eip7702Auth`); NOT viem's built-in account-authorization, which requires a
   * `PrivateKeyAccount` and cannot express Avok's passkey signer.
   */
  authorization?: SignedAuthorization;
}

/** A dummy 65-byte ECDSA signature so gas estimation sees a realistic verification cost. */
const STUB_SIGNATURE = ("0x" +
  "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7" +
  "7ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7" +
  "1b") as Hex;

/** Builds a v0.8 UserOperation whose `callData` is the standard ERC-7821 `execute(MODE_BATCH, calls)`. */
export function buildUserOp(args: BuildUserOpArgs): AvokUserOperation {
  const op: AvokUserOperation = {
    sender: args.sender,
    nonce: args.nonce,
    callData: encodeExecuteBatch([...args.calls]),
    callGasLimit: args.gas?.callGasLimit ?? 0n,
    verificationGasLimit: args.gas?.verificationGasLimit ?? 0n,
    preVerificationGas: args.gas?.preVerificationGas ?? 0n,
    maxFeePerGas: args.fees.maxFeePerGas,
    maxPriorityFeePerGas: args.fees.maxPriorityFeePerGas,
    signature: STUB_SIGNATURE,
  };
  if (args.paymaster) {
    op.paymaster = args.paymaster.paymaster;
    op.paymasterData = args.paymaster.paymasterData;
    if (args.paymaster.paymasterVerificationGasLimit !== undefined)
      op.paymasterVerificationGasLimit = args.paymaster.paymasterVerificationGasLimit;
    if (args.paymaster.paymasterPostOpGasLimit !== undefined)
      op.paymasterPostOpGasLimit = args.paymaster.paymasterPostOpGasLimit;
  }
  if (args.authorization) op.authorization = args.authorization;
  return op;
}

/** The v0.8 userOpHash — an EIP-712 hash the account signs directly (viem's canonical computation). */
export function getAvokUserOpHash(userOperation: AvokUserOperation, chainId: number): Hex {
  return getUserOperationHash({
    chainId,
    entryPointAddress: entryPoint08Address,
    entryPointVersion: "0.8",
    userOperation,
  });
}

/** The viem client shape `toSmartAccount` expects (used for `getNonce`/`getCode`, not for signing). */
export type AvokSmartAccountClient = SmartAccountImplementation["client"];

export interface ToAvokSmartAccountArgs {
  signer: UserOpSigner;
  sender: Address;
  chainId: number;
  client: AvokSmartAccountClient;
}

/**
 * A viem custom smart account whose `signUserOperation` delegates to the Avok `Connection`
 * (`signUserOpHash(getAvokUserOpHash(op))`). Under EIP-7702 the account IS the EOA, so there is no
 * factory — `getFactoryArgs` returns none and the 7702 delegation rides on the UserOp's
 * `authorization` (see `buildUserOp`).
 */
export async function toAvokSmartAccount(args: ToAvokSmartAccountArgs): Promise<SmartAccount> {
  const { signer, sender, chainId, client } = args;
  return toSmartAccount({
    client,
    entryPoint: { abi: entryPoint08Abi, address: entryPoint08Address, version: "0.8" },
    async getAddress() {
      return sender;
    },
    async encodeCalls(calls) {
      return encodeExecuteBatch(calls.map((c) => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? "0x" })));
    },
    async getFactoryArgs() {
      return { factory: undefined, factoryData: undefined };
    },
    async getStubSignature() {
      return STUB_SIGNATURE;
    },
    // The sponsored rail signs ONLY the userOpHash (below). Message / typed-data signing is the
    // Connection/provider's job, not this internal account — fail loud if something routes here.
    async signMessage(): Promise<Hex> {
      throw new Error("toAvokSmartAccount: signMessage is not supported; sign via the Connection/provider");
    },
    async signTypedData(): Promise<Hex> {
      throw new Error("toAvokSmartAccount: signTypedData is not supported; sign via the Connection/provider");
    },
    async signUserOperation(parameters) {
      const { chainId: opChainId = chainId, ...userOperation } = parameters;
      const userOpHash = getAvokUserOpHash({ ...userOperation, sender } as AvokUserOperation, opChainId);
      return signer.signUserOpHash(userOpHash);
    },
  });
}

export type { SignedAuthorization, UserOperation };
