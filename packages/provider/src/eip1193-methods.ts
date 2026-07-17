import { hexToNumber, hexToString, isHex, type Address, type Hex, type TypedDataDefinition } from "viem";
import type { Account } from "@avokjs/sdk-core";
import type { SendEngine } from "@avokjs/sdk-core/internal";
import type { Call, Receipt } from "@avokjs/txengine";

/** An EIP-1193 JSON-RPC error (the shape viem/wagmi expect on rejection). */
export class ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
    this.data = data;
  }
}

/** The subset of a `Connection` the method handlers dispatch to (the signer seam of the engine). */
export interface ProviderConnection {
  account(): Account | null;
  status(): boolean;
  continue?(opts?: unknown): Promise<Account>;
  signMessage(a: { message: string }): Promise<Hex>;
  signTypedData(a: TypedDataDefinition): Promise<Hex>;
}

/** A single call in an EIP-5792 `wallet_sendCalls` batch (values are `0x`-hex on the wire). */
interface Eip5792Call {
  to?: string;
  value?: string;
  data?: string;
}

/** Everything a handler needs: the connection (signer/state) plus chain, events, and the send engine. */
export interface ProviderRuntime {
  readonly connection: ProviderConnection;
  readonly engine: SendEngine;
  /** In-flight sends, keyed by bundle id, so `wallet_getCallsStatus` can re-poll their status. */
  readonly calls: Map<string, Receipt>;
  getChainId(): number;
  setChainId(id: number): void;
  emit(event: string, ...args: unknown[]): void;
}

/** Map one on-the-wire EIP-5792 call to the engine's `Call`. */
function toCall(c: Eip5792Call): Call {
  if (!c.to) throw new ProviderRpcError(-32602, "Each call requires a `to` address");
  return { to: c.to as Address, value: c.value ? BigInt(c.value) : 0n, data: (c.data ?? "0x") as Hex };
}

const ZERO_HASH = `0x${"0".repeat(64)}` as const;

/** Shape a `Receipt` into the EIP-5792 `wallet_getCallsStatus` result. The receipt carries the full
 *  field set viem/wagmi's `getCallsStatus` parses (`blockHash`/`blockNumber`/`gasUsed`); Avok tracks
 *  only the tx hash + status, so the block fields are zeroed rather than invented. */
function toCallsStatus(r: Receipt): unknown {
  const mined = r.status === "confirmed" || r.status === "failed";
  return {
    version: "2.0.0",
    id: r.id,
    chainId: chainIdHex(r.chainId),
    status: mined ? 200 : 100, // 5792: 100 pending, 200 included (success OR revert)
    atomic: false,
    receipts: mined
      ? [{
          status: r.status === "confirmed" ? "0x1" : "0x0",
          transactionHash: r.txHash ?? r.id,
          blockHash: ZERO_HASH,
          blockNumber: "0x0",
          gasUsed: "0x0",
          logs: [],
        }]
      : [],
  };
}

/** `0x`-prefixed hex of a chain id, per EIP-695. */
export function chainIdHex(id: number): `0x${string}` {
  return `0x${id.toString(16)}`;
}

/** The active EVM address as a single-element array, or `[]` when logged out. */
export function accountsOf(rt: ProviderRuntime): string[] {
  const a = rt.connection.account();
  return a ? [a.evm.address] : [];
}

/**
 * Assert the address a signing request names is the wallet's active account, else 4100
 * (unauthorized). A dapp may never make the wallet sign as an address it does not control.
 */
function requireActiveAddress(rt: ProviderRuntime, claimed: unknown): void {
  const active = rt.connection.account()?.evm.address;
  if (!active) throw new ProviderRpcError(4100, "No active account");
  if (typeof claimed !== "string" || claimed.toLowerCase() !== active.toLowerCase()) {
    throw new ProviderRpcError(4100, `Not authorized to sign for ${String(claimed)}`);
  }
}

/**
 * Dispatch one EIP-1193 request. Read + connect handlers live here; sign (Task 3) and send (Task 4)
 * extend this switch. Unknown methods reject with 4200, per EIP-1193.
 */
export async function dispatch(
  rt: ProviderRuntime,
  method: string,
  _params: unknown[],
): Promise<unknown> {
  switch (method) {
    case "eth_requestAccounts": {
      // The dapp↔wallet connect. Own-origin apps are already logged in (the facade did it); an
      // external/shared-origin dapp with no session logs in here (may pop the auth origin).
      if (!rt.connection.account() && typeof rt.connection.continue === "function") {
        await rt.connection.continue();
      }
      return accountsOf(rt);
    }
    case "eth_accounts":
      // Passive: never triggers a login ceremony.
      return accountsOf(rt);
    case "eth_chainId":
      return chainIdHex(rt.getChainId());

    case "personal_sign": {
      // viem/wagmi/ethers order: [data, address]. `data` is the message hex-encoded (UTF-8), which
      // hexToString round-trips to the exact preimage the connection's string signer re-encodes.
      const [data, address] = _params as [unknown, unknown];
      requireActiveAddress(rt, address);
      const message = typeof data === "string" && isHex(data) ? hexToString(data) : String(data);
      return rt.connection.signMessage({ message });
    }

    case "eth_signTypedData_v4": {
      // Order: [address, typedData]. viem sends the payload JSON-stringified; some tools pass the object.
      const [address, payload] = _params as [unknown, unknown];
      requireActiveAddress(rt, address);
      const typedData = (typeof payload === "string" ? JSON.parse(payload) : payload) as TypedDataDefinition;
      return rt.connection.signTypedData(typedData);
    }

    case "wallet_sendCalls": {
      // EIP-5792 + ERC-7677. A `paymasterService` capability (dapp-supplied here; operator-default is
      // the config's paymaster/bundler) routes this send FRONTED; the per-send fee token rides in its
      // `context`. A single-token paymaster (e.g. Circle USDC) omits the token, so fall back to the
      // chain's default registry fee token. No `paymasterService` ⇒ self-pay (no fee token passed).
      const [req] = _params as [{
        chainId?: string;
        calls?: Eip5792Call[];
        capabilities?: { paymasterService?: { url?: string; context?: { token?: string } } };
      }];
      const chainId = req.chainId ? hexToNumber(req.chainId as Hex) : rt.getChainId();
      const pm = req.capabilities?.paymasterService;
      const opts: { chainId: number; feeToken?: Address | null } = { chainId };
      if (pm) {
        const token = pm.context?.token ?? rt.engine.capabilities(chainId).feeTokens[0]?.address ?? null;
        opts.feeToken = token as Address | null;
      }
      const receipt = await rt.engine.send((req.calls ?? []).map(toCall), opts);
      rt.calls.set(receipt.id, receipt);
      return { id: receipt.id };
    }

    case "wallet_getCapabilities": {
      // EIP-5792 / ERC-7677. `[address, chainIds?]` → per-chain `{ paymasterService: { supported },
      // feeTokens }`. `feeTokens` is the fee-token picker's option list. Absent chainIds ⇒ active chain.
      const [, chainIdsParam] = _params as [unknown, (string | number)[] | undefined];
      const chainIds =
        Array.isArray(chainIdsParam) && chainIdsParam.length > 0
          ? chainIdsParam.map((c) => (typeof c === "string" ? hexToNumber(c as Hex) : c))
          : [rt.getChainId()];
      const out: Record<string, unknown> = {};
      for (const id of chainIds) out[chainIdHex(id)] = rt.engine.capabilities(id);
      return out;
    }

    case "wallet_getCallsStatus": {
      const [id] = _params as [string];
      const known = rt.calls.get(id);
      if (!known) throw new ProviderRpcError(-32602, `Unknown bundle id: ${String(id)}`);
      const updated = await rt.engine.status(known);
      rt.calls.set(id, updated);
      return toCallsStatus(updated);
    }

    case "eth_sendTransaction": {
      // Compatibility for older ethers/tools: wrap the single tx into a 1-call wallet_sendCalls.
      const [tx] = _params as [Eip5792Call & { chainId?: string }];
      const chainId = tx.chainId ? hexToNumber(tx.chainId as Hex) : rt.getChainId();
      const receipt = await rt.engine.send([toCall(tx)], { chainId });
      rt.calls.set(receipt.id, receipt);
      return receipt.txHash ?? receipt.id; // legacy callers expect the tx hash
    }

    case "wallet_switchEthereumChain": {
      const [{ chainId }] = _params as [{ chainId: string }];
      rt.setChainId(hexToNumber(chainId as Hex));
      rt.emit("chainChanged", chainId);
      return null;
    }

    default:
      throw new ProviderRpcError(4200, `Unsupported method: ${method}`);
  }
}
