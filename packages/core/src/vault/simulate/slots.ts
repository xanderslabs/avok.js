/**
 * Balance-slot discovery via `eth_createAccessList` — the fallback `deltas.ts`'s header names for
 * when log-diffing is insufficient: a fee-on-transfer or rebasing token whose `Transfer` event amount
 * does not equal what the balance actually changed by, or any other case where the standard events
 * cannot be trusted at face value.
 *
 * SCOPE, STATED PLAINLY: this module finds WHICH storage slot holds `user`'s balance in `token` — the
 * one piece `eth_createAccessList` can tell you that a plain simulation cannot. It does NOT read that
 * slot before and after a batch and diff it; wiring that into `client.ts`'s simulation (a state-read
 * appended to the batch, or a second simulation pass) is real work this module does not yet do. Treat
 * `discoverBalanceSlot` as a primitive a future pass builds on, not a complete balance-verification
 * path. Native ETH needs no such discovery at all — it is not behind a `balanceOf`, it is a
 * protocol-level account field, readable directly via `RpcClient.getBalance`.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import type { RpcClient } from "../../evm/rpc.js";

const BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Best-effort: which storage slot of `token` holds `user`'s balance, per the access list
 * `eth_createAccessList` reports for a `balanceOf(user)` call. Returns `null` when the RPC does not
 * support the method, the call fails, or the access list names no slot for `token` — never throws for
 * any of those, since this is a hint the caller may simply not get, not a required step.
 *
 * HEURISTIC, NOT A GUARANTEE: a `balanceOf` implementation that reads more than one slot (a proxy, a
 * token with a non-trivial accounting scheme) returns several storage keys; this returns the first,
 * which is usually but not certainly the balance slot itself.
 */
export async function discoverBalanceSlot(rpc: RpcClient, token: Address, user: Address): Promise<Hex | null> {
  if (!rpc.createAccessList) return null;

  const data = encodeFunctionData({ abi: BALANCE_OF_ABI, functionName: "balanceOf", args: [user] });

  let result: Awaited<ReturnType<NonNullable<RpcClient["createAccessList"]>>>;
  try {
    result = await rpc.createAccessList({ to: token, data });
  } catch {
    return null;
  }

  const entry = result.accessList.find((e) => e.address.toLowerCase() === token.toLowerCase());
  if (!entry || entry.storageKeys.length === 0) return null;
  return entry.storageKeys[0];
}
