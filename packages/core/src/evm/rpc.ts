import type { Address, Hex } from "viem";

export interface SimCall {
  from?: Address;
  to: Address;
  value?: bigint;
  data?: Hex;
}
export interface StateOverride {
  address: Address;
  code?: Hex;
  balance?: bigint;
}
export interface SimulateArgs {
  account?: Address;
  calls: SimCall[];
  stateOverrides?: StateOverride[];
}
export interface SimCallResult {
  status: "success" | "failure";
  gasUsed: bigint;
  returnData: Hex;
  error?: string;
}
export interface ReadArgs {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/** The chain boundary. Engine logic is written against this port; tests use a fake. */
export interface RpcClient {
  chainId(): Promise<number>;
  /** "0x" when the address has no code. */
  getCode(address: Address): Promise<Hex>;
  getTransactionCount(address: Address): Promise<number>;
  /** eth_simulateV1 of a sequential call list, with optional state overrides. */
  simulateCalls(args: SimulateArgs): Promise<SimCallResult[]>;
  call(args: SimCall & { stateOverrides?: StateOverride[] }): Promise<Hex>;
  estimateGas(args: SimCall & { stateOverrides?: StateOverride[]; authorizationList?: unknown[] }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  /**
   * The current block's EIP-1559 BASE FEE — the price the chain actually charges, before the tip.
   *
   * NOT the same thing as `getGasPrice()`, and assuming it was is what over-charged every user.
   * `eth_gasPrice` returns base + a SUGGESTED TIP, so pricing a transaction at `gasPrice × 2` (base
   * doubled, as it were) over-states the real cost whenever that suggestion is large: on Arc,
   * gasPrice ≈ 30.8 gwei while the base fee was 11.2, and the chain charged base + tip = 42, not 61.7.
   */
  getBaseFeePerGas(): Promise<bigint>;
  /**
   * The tip the CHAIN ITSELF suggests bidding (`eth_maxPriorityFeePerGas`).
   *
   * This is the answer to "what should I bid", and a submitter that does not ask for it is guessing.
   * The guess that shipped was `maxPriorityFeePerGas = eth_gasPrice`, i.e. the WHOLE gas price bid as
   * a tip — but gasPrice is base + a suggested tip, so that bids the base fee a second time. Measured
   * on Arc: gasPrice 22.435 gwei, base 20.0, suggested tip 2.435. The chain charges base + tip, so the
   * overbid paid 42.435 gwei for a transaction that costs 22.435 — and the user was charged for it.
   *
   * 0 on a chain with no tip market, where `getBaseFeePerGas()` is the whole price.
   */
  getMaxPriorityFeePerGas(): Promise<bigint>;
  readContract<T>(args: ReadArgs): Promise<T>;
  /** Native balance, in wei. Used by the enrolment affordability gate. */
  getBalance(address: Address): Promise<bigint>;
  sendRawTransaction(serialized: Hex): Promise<Hex>;
  getTransactionReceipt(
    hash: Hex,
  ): Promise<{ status: "success" | "reverted"; transactionHash: Hex; blockNumber?: bigint } | null>;
  /** Current chain head. Optional — used for confirmation-depth gating when configured. */
  getBlockNumber?(): Promise<bigint>;
}

/** Minimal subset of a viem client the adapter relies on (kept structural for testability). */
export interface ViemLike {
  getChainId(): Promise<number>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  getTransactionCount(args: { address: Address }): Promise<number>;
  simulateCalls(args: {
    account?: Address;
    calls: { to: Address; value?: bigint; data?: Hex }[];
    stateOverrides?: { address: Address; code?: Hex; balance?: bigint }[];
  }): Promise<{ results: { status: "success" | "failure"; gasUsed: bigint; data: Hex }[] }>;
  call(args: { to: Address; data?: Hex; value?: bigint; stateOverride?: unknown }): Promise<{ data?: Hex }>;
  estimateGas(args: {
    to: Address;
    data?: Hex;
    value?: bigint;
    account?: Address;
    stateOverride?: unknown;
    authorizationList?: unknown[];
  }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  /** viem: tries `eth_maxPriorityFeePerGas`, else derives `gasPrice - baseFeePerGas` (clamped ≥ 0),
   *  and throws Eip1559FeesNotSupportedError when the chain reports no base fee. */
  estimateMaxPriorityFeePerGas(): Promise<bigint>;
  getBlock(args?: { blockTag?: "latest" }): Promise<{ baseFeePerGas?: bigint | null }>;
  readContract(args: ReadArgs): Promise<unknown>;
  getBalance(args: { address: Address }): Promise<bigint>;
  sendRawTransaction(args: { serializedTransaction: Hex }): Promise<Hex>;
  getTransactionReceipt(args: {
    hash: Hex;
  }): Promise<{ status: "success" | "reverted"; transactionHash: Hex; blockNumber?: bigint }>;
  getBlockNumber(): Promise<bigint>;
}

/** Wrap a viem public/wallet client as an RpcClient. */
export function createViemRpcClient(client: ViemLike): RpcClient {
  return {
    chainId: () => client.getChainId(),
    async getCode(address) {
      return (await client.getCode({ address })) ?? "0x";
    },
    getTransactionCount: (address) => client.getTransactionCount({ address }),
    async simulateCalls(args) {
      const res = await client.simulateCalls({
        account: args.account,
        calls: args.calls.map((c) => ({ to: c.to, value: c.value, data: c.data })),
        stateOverrides: args.stateOverrides,
      });
      return res.results.map((r) => ({ status: r.status, gasUsed: r.gasUsed, returnData: r.data }));
    },
    async call(args) {
      const r = await client.call({
        to: args.to,
        data: args.data,
        value: args.value,
        stateOverride: args.stateOverrides,
      });
      return r.data ?? "0x";
    },
    estimateGas: (args) =>
      client.estimateGas({
        to: args.to,
        data: args.data,
        value: args.value,
        account: args.from,
        stateOverride: args.stateOverrides,
        authorizationList: args.authorizationList,
      }),
    getGasPrice: () => client.getGasPrice(),
    getBaseFeePerGas: async () => {
      const block = await client.getBlock({ blockTag: "latest" });
      // Pre-1559 chains report no base fee; there, gasPrice IS the price and the tip model collapses.
      return block.baseFeePerGas ?? (await client.getGasPrice());
    },
    getMaxPriorityFeePerGas: async () => {
      try {
        return await client.estimateMaxPriorityFeePerGas();
      } catch (e) {
        // Only ONE failure means "this chain has no tip market": viem raises
        // Eip1559FeesNotSupportedError when the block carries no base fee. There, getBaseFeePerGas()
        // above returns gasPrice, so a 0 tip prices the transaction at exactly gasPrice — correct.
        //
        // Anything else (an RPC that is down, a rate limit) must PROPAGATE. Swallowing it would quote
        // a 0 tip off a transport failure, under-bid the transaction, and leave the sponsor short —
        // an error path that eats the error is how the last round of bugs got their disguise.
        if ((e as { name?: string })?.name === "Eip1559FeesNotSupportedError") return 0n;
        throw e;
      }
    },
    readContract: <T>(args: ReadArgs) => client.readContract(args) as Promise<T>,
    getBalance: (address) => client.getBalance({ address }),
    sendRawTransaction: (serialized) => client.sendRawTransaction({ serializedTransaction: serialized }),
    async getTransactionReceipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return { status: r.status, transactionHash: r.transactionHash, blockNumber: r.blockNumber };
      } catch {
        return null; // viem throws TransactionReceiptNotFoundError when not yet mined
      }
    },
    getBlockNumber: () => client.getBlockNumber(),
  };
}
