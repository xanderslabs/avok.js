import type { Address, Hex, SignedAuthorization } from "viem";
import { getUserOperationHash, entryPoint08Address } from "viem/account-abstraction";
import type { Call } from "../wallet/index.js";
import { encodeExecuteBatch } from "./sim-methods.js";
import type { AvokUserOperation } from "./bundler.js";

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
