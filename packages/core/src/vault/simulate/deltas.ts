/**
 * Turning a simulated batch's logs (plus the calldata itself) into asset deltas and approval
 * grants — the "you send / you receive" and approval-warning rows TDD §5 step 2 describes.
 *
 * OUTGOING native value needs no simulation: `Call.value` is part of what is being signed, so it is
 * known before any RPC call is made. Everything else (token transfers, approvals, and any INCOMING
 * value a call produces — a swap's output, say) can only be known by watching what the batch actually
 * did, which is why this module reads it out of `eth_simulateV1`'s per-call logs rather than the
 * calldata alone.
 *
 * Standard events only: `Transfer`/`Approval` (ERC-20), `Transfer` (ERC-721 — same signature STRING as
 * ERC-20's, so the same topic0, but with tokenId indexed, giving it one more topic), `ApprovalForAll`
 * (ERC-721/1155), and `TransferSingle`/`TransferBatch` (ERC-1155, each with its OWN distinct topic0).
 * Dispatch is by topic0 everywhere it is unambiguous; only the ERC-20/ERC-721 `Transfer` collision
 * (identical topic0) falls back to `topics.length` (3 vs 4) to tell them apart. A token that emits
 * none of these is invisible to this module — nothing here claims otherwise;
 * `vault/simulate/slots.ts` is the documented fallback for exactly that gap, for what it can help with.
 */
import { decodeEventLog, getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { isUnlimitedAmount } from "../../auth-popup/sign/danger.js";
import type { SimLog } from "../../evm/rpc.js";

export type AssetDeltaKind = "native" | "erc20" | "erc721" | "erc1155";

export interface AssetDelta {
  kind: AssetDeltaKind;
  /** Absent for native. */
  token?: Address;
  amount: bigint;
  direction: "in" | "out";
  /** ERC-721/1155 only. */
  tokenId?: bigint;
}

export interface ApprovalGrant {
  token: Address;
  spender: Address;
  /** Base units for an ERC-20 allowance; always 0 for `erc721-all`, where the boolean flag IS the
   *  grant — see `approved`. */
  amount: bigint;
  unlimited: boolean;
  kind: "erc20" | "erc721-all";
  /** `setApprovalForAll`'s boolean. `false` = this is a REVOKE, not a grant — never flagged as
   *  dangerous regardless of `unlimited`. */
  approved: boolean;
}

const ERC20_TRANSFER = {
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

const ERC721_TRANSFER = {
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: true, name: "tokenId", type: "uint256" },
  ],
} as const;

const ERC20_APPROVAL = {
  type: "event",
  name: "Approval",
  inputs: [
    { indexed: true, name: "owner", type: "address" },
    { indexed: true, name: "spender", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

const APPROVAL_FOR_ALL = {
  type: "event",
  name: "ApprovalForAll",
  inputs: [
    { indexed: true, name: "owner", type: "address" },
    { indexed: true, name: "operator", type: "address" },
    { indexed: false, name: "approved", type: "bool" },
  ],
} as const;

const TRANSFER_SINGLE = {
  type: "event",
  name: "TransferSingle",
  inputs: [
    { indexed: true, name: "operator", type: "address" },
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "id", type: "uint256" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

const TRANSFER_BATCH = {
  type: "event",
  name: "TransferBatch",
  inputs: [
    { indexed: true, name: "operator", type: "address" },
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "ids", type: "uint256[]" },
    { indexed: false, name: "values", type: "uint256[]" },
  ],
} as const;

/** The event selector (topic0) for a signature string, computed rather than hand-copied so a typo in
 *  a 64-hex-digit constant can never silently misroute a log. */
const selector = (signature: string) => keccak256(toBytes(signature));

const TOPIC0 = {
  transfer: selector("Transfer(address,address,uint256)"), // ERC-20 AND ERC-721 share this — see header.
  approval: selector("Approval(address,address,uint256)"),
  approvalForAll: selector("ApprovalForAll(address,address,bool)"),
  transferSingle: selector("TransferSingle(address,address,address,uint256,uint256)"),
  transferBatch: selector("TransferBatch(address,address,address,uint256[],uint256[])"),
};

function directionFor(account: Address, from: Address, to: Address): "in" | "out" | null {
  const a = account.toLowerCase();
  if (from.toLowerCase() === a) return "out";
  if (to.toLowerCase() === a) return "in";
  return null;
}

export function decodeDeltasAndApprovals(
  logs: SimLog[],
  account: Address,
): { deltas: AssetDelta[]; approvals: ApprovalGrant[] } {
  const deltas: AssetDelta[] = [];
  const approvals: ApprovalGrant[] = [];

  for (const log of logs) {
    const topic0 = log.topics[0];
    const token = getAddress(log.address);

    try {
      if (topic0 === TOPIC0.transfer) {
        // Identical topic0 for ERC-20 and ERC-721; topics.length (indexed tokenId or not) is the
        // only thing that tells them apart.
        if (log.topics.length === 4) {
          const { args } = decodeEventLog({
            abi: [ERC721_TRANSFER],
            topics: log.topics as [Hex, ...Hex[]],
            data: log.data,
          });
          const direction = directionFor(account, args.from, args.to);
          if (direction) deltas.push({ kind: "erc721", token, amount: 1n, tokenId: args.tokenId, direction });
        } else {
          const { args } = decodeEventLog({
            abi: [ERC20_TRANSFER],
            topics: log.topics as [Hex, ...Hex[]],
            data: log.data,
          });
          const direction = directionFor(account, args.from, args.to);
          if (direction) deltas.push({ kind: "erc20", token, amount: args.value, direction });
        }
      } else if (topic0 === TOPIC0.approval) {
        const { args } = decodeEventLog({
          abi: [ERC20_APPROVAL],
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        approvals.push({
          token,
          spender: getAddress(args.spender),
          amount: args.value,
          unlimited: isUnlimitedAmount(args.value.toString()),
          kind: "erc20",
          approved: true,
        });
      } else if (topic0 === TOPIC0.approvalForAll) {
        const { args } = decodeEventLog({
          abi: [APPROVAL_FOR_ALL],
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        approvals.push({
          token,
          spender: getAddress(args.operator),
          amount: 0n,
          unlimited: false,
          kind: "erc721-all",
          approved: args.approved,
        });
      } else if (topic0 === TOPIC0.transferSingle) {
        const { args } = decodeEventLog({
          abi: [TRANSFER_SINGLE],
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        const direction = directionFor(account, args.from, args.to);
        if (direction) deltas.push({ kind: "erc1155", token, amount: args.value, tokenId: args.id, direction });
      } else if (topic0 === TOPIC0.transferBatch) {
        const { args } = decodeEventLog({
          abi: [TRANSFER_BATCH],
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        const direction = directionFor(account, args.from, args.to);
        if (direction) {
          // One AssetDelta per (token, tokenId) pair — never collapsed into one line, or the screen
          // would show a single number that does not correspond to anything actually received.
          for (let i = 0; i < args.ids.length; i++) {
            deltas.push({ kind: "erc1155", token, amount: args.values[i] ?? 0n, tokenId: args.ids[i], direction });
          }
        }
      }
      // Any other topic0: not one of the five events this module understands — skip, never throw.
    } catch {
      // A log whose topic0 matched but whose data did not decode cleanly (a proxy emitting a
      // same-named event with a different shape, say) is skipped rather than crashing the whole
      // simulation — same "don't hide, don't fabricate" policy as consent.ts's raw-calldata fallback.
    }
  }

  return { deltas, approvals };
}

/** Every `Call.value` the batch sends OUT, known from the calldata alone — never needs simulation.
 *  Incoming native value (e.g. a swap's ETH output) is NOT covered: a raw ETH transfer via
 *  `.call{value}` emits no log at all, so this module cannot see it (see this file's header). */
export function nativeDeltasFromCalls(calls: { value: bigint }[]): AssetDelta[] {
  return calls
    .filter((c) => c.value > 0n)
    .map((c) => ({ kind: "native" as const, amount: c.value, direction: "out" as const }));
}
