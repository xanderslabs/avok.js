/**
 * Thrown when a per-send fee token (EVM or Solana `feeToken`) is NOT a supported fee token on the
 * chain the transaction executes on.
 *
 * Fee tokens are ERC-20 / SPL *addresses*, and an address is chain-specific — USDC on Base is a
 * different address than USDC on Arbitrum. Passing a token that means nothing on the target chain is
 * a configuration bug, not a runtime condition to swallow into a boolean, so resolution throws this
 * named error rather than silently forwarding a dead address to the paymaster.
 */
export class UnsupportedFeeTokenError extends Error {
  /** The offending fee-token address (EVM) or mint (Solana). */
  readonly token: string;
  /** The target chain the token was rejected on, as a namespaced id (`eip155:<id>` | `solana:<cluster>`). */
  readonly chain: string;

  constructor(token: string, chain: number | string) {
    const chainId = typeof chain === "number" ? `eip155:${chain}` : chain;
    const chainLabel = typeof chain === "number" ? `chain ${chain}` : chain;
    super(
      `Fee token ${token} is not a supported fee token on ${chainLabel}. Fee-token addresses are ` +
        `chain-specific — pass a token supported on this chain, or omit the fee token (feeToken: null) to self-pay.`,
    );
    this.name = "UnsupportedFeeTokenError";
    this.token = token;
    this.chain = chainId;
  }
}
