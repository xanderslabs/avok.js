import type { Address, Hex } from "viem";
import type { RpcClient, SimCallResult, SimulateArgs, SimCall, StateOverride, ReadArgs } from "./rpc.js";

export interface FakeRpcConfig {
  chainId?: number;
  code?: Record<string, Hex>;
  nonces?: Record<string, number>;
  simResults?: SimCallResult[];
  callReturn?: Hex;
  estimateGas?: bigint;
  gasPrice?: bigint;
  baseFee?: bigint;
  suggestedTip?: bigint;
  balance?: bigint;
  reads?: Record<string, unknown>;          // keyed by `${address}:${functionName}`
  receipts?: Record<string, { status: "success" | "reverted"; transactionHash: Hex }>;
  callThrows?: boolean;
  estimateGasThrows?: boolean;
}

export class FakeRpcClient implements RpcClient {
  sent: Hex[] = [];
  lastSimulate?: SimulateArgs;
  lastEstimateGas?: SimCall & { stateOverrides?: StateOverride[] };
  constructor(private cfg: FakeRpcConfig = {}) {}
  chainId() { return Promise.resolve(this.cfg.chainId ?? 10); }
  getCode(a: Address) { return Promise.resolve(this.cfg.code?.[a.toLowerCase()] ?? this.cfg.code?.[a] ?? "0x"); }
  getTransactionCount(a: Address) { return Promise.resolve(this.cfg.nonces?.[a.toLowerCase()] ?? this.cfg.nonces?.[a] ?? 0); }
  simulateCalls(args: SimulateArgs) { this.lastSimulate = args; return Promise.resolve(this.cfg.simResults ?? args.calls.map(() => ({ status: "success" as const, gasUsed: 21000n, returnData: "0x" as Hex }))); }
  call(_args: SimCall & { stateOverrides?: StateOverride[] }) {
    if (this.cfg.callThrows) return Promise.reject(new Error("execution reverted"));
    return Promise.resolve(this.cfg.callReturn ?? "0x");
  }
  estimateGas(args: SimCall & { stateOverrides?: StateOverride[] }) {
    this.lastEstimateGas = args;
    if (this.cfg.estimateGasThrows) return Promise.reject(new Error("execution reverted"));
    return Promise.resolve(this.cfg.estimateGas ?? 50000n);
  }
  // THE THREE FEE NUMBERS ARE THREE DIFFERENT NUMBERS, and every fee bug that has shipped here was a
  // confusion between two of them. The defaults are therefore mutually distinct AND satisfy the real
  // chain's identity `gasPrice == baseFee + suggestedTip` (1.0 == 0.4 + 0.6 gwei), so a fake cannot
  // flatter code that mixes them up:
  //
  //   - a fake with `baseFee == gasPrice` cannot see pricing that doubled gasPrice as if it were base;
  //   - a fake with `suggestedTip == gasPrice` cannot see the submitter bidding the whole gasPrice as
  //     a tip — which paid the base fee twice and overcharged every user by 89% on Arc.
  getGasPrice() { return Promise.resolve(this.cfg.gasPrice ?? 1_000_000_000n); }
  getBaseFeePerGas() { return Promise.resolve(this.cfg.baseFee ?? 400_000_000n); }
  getMaxPriorityFeePerGas() { return Promise.resolve(this.cfg.suggestedTip ?? 600_000_000n); }
  getBalance() { return Promise.resolve(this.cfg.balance ?? 10n ** 18n); }
  readContract<T>(args: ReadArgs) { return Promise.resolve(this.cfg.reads?.[`${args.address}:${args.functionName}`] as T); }
  sendRawTransaction(s: Hex) { this.sent.push(s); return Promise.resolve(("0x" + "ab".repeat(32)) as Hex); }
  getTransactionReceipt(hash: Hex) { return Promise.resolve(this.cfg.receipts?.[hash] ?? null); }
}

/** A fetch double routed by `${method} ${pathSuffix}`. */
export function makeFakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = (init?.method ?? "GET").toUpperCase();
    const match = Object.keys(routes).find((k) => {
      const [m, suffix] = k.split(" ");
      return m === method && url.endsWith(suffix);
    });
    if (!match) return Promise.resolve(new Response("not found", { status: 404 }));
    const route = routes[match];
    return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } }));
  };
  return Object.assign(fn, { calls });
}
