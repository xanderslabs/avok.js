import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, pad, toBytes, toHex, type Address, type Hex } from "viem";
import { decodeDeltasAndApprovals, nativeDeltasFromCalls } from "../../../src/vault/simulate/deltas.js";
import type { SimLog } from "../../../src/evm/rpc.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x9999999999999999999999999999999999999999" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;

function selector(sig: string): Hex {
  return keccak256(toBytes(sig));
}
function addrTopic(addr: Address): Hex {
  return pad(addr, { size: 32 });
}
function uintTopic(n: bigint): Hex {
  return pad(toHex(n), { size: 32 });
}

const ERC20_TRANSFER_TOPIC0 = selector("Transfer(address,address,uint256)");
const APPROVAL_FOR_ALL_TOPIC0 = selector("ApprovalForAll(address,address,bool)");
const TRANSFER_SINGLE_TOPIC0 = selector("TransferSingle(address,address,address,uint256,uint256)");
const TRANSFER_BATCH_TOPIC0 = selector("TransferBatch(address,address,address,uint256[],uint256[])");

describe("decodeDeltasAndApprovals — ERC-721", () => {
  it("a Transfer with an indexed tokenId (4 topics) decodes as erc721, not erc20", () => {
    const log: SimLog = {
      address: TOKEN,
      topics: [ERC20_TRANSFER_TOPIC0, addrTopic(OTHER), addrTopic(ACCOUNT), uintTopic(42n)],
      data: "0x",
    };
    const { deltas } = decodeDeltasAndApprovals([log], ACCOUNT);
    expect(deltas).toEqual([{ kind: "erc721", token: TOKEN, amount: 1n, tokenId: 42n, direction: "in" }]);
  });

  it("ApprovalForAll with approved=false is a revoke, still surfaced (approved: false)", () => {
    const log: SimLog = {
      address: TOKEN,
      topics: [APPROVAL_FOR_ALL_TOPIC0, addrTopic(ACCOUNT), addrTopic(OTHER)],
      data: encodeAbiParameters([{ type: "bool" }], [false]),
    };
    const { approvals } = decodeDeltasAndApprovals([log], ACCOUNT);
    expect(approvals).toEqual([
      { token: TOKEN, spender: OTHER, amount: 0n, unlimited: false, kind: "erc721-all", approved: false },
    ]);
  });
});

describe("decodeDeltasAndApprovals — ERC-1155", () => {
  it("TransferSingle decodes with its tokenId and amount", () => {
    const log: SimLog = {
      address: TOKEN,
      topics: [TRANSFER_SINGLE_TOPIC0, addrTopic(OTHER), addrTopic(OTHER), addrTopic(ACCOUNT)],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [7n, 3n]),
    };
    const { deltas } = decodeDeltasAndApprovals([log], ACCOUNT);
    expect(deltas).toEqual([{ kind: "erc1155", token: TOKEN, amount: 3n, tokenId: 7n, direction: "in" }]);
  });

  it("TransferBatch fans out to one delta per (token, tokenId) pair", () => {
    const log: SimLog = {
      address: TOKEN,
      topics: [TRANSFER_BATCH_TOPIC0, addrTopic(OTHER), addrTopic(ACCOUNT), addrTopic(OTHER)],
      data: encodeAbiParameters(
        [{ type: "uint256[]" }, { type: "uint256[]" }],
        [
          [1n, 2n],
          [10n, 20n],
        ],
      ),
    };
    const { deltas } = decodeDeltasAndApprovals([log], ACCOUNT);
    expect(deltas).toEqual([
      { kind: "erc1155", token: TOKEN, amount: 10n, tokenId: 1n, direction: "out" },
      { kind: "erc1155", token: TOKEN, amount: 20n, tokenId: 2n, direction: "out" },
    ]);
  });
});

describe("decodeDeltasAndApprovals — irrelevant transfers are excluded", () => {
  it("a transfer between two OTHER addresses produces no delta for our account", () => {
    const log: SimLog = {
      address: TOKEN,
      topics: [ERC20_TRANSFER_TOPIC0, addrTopic(OTHER), addrTopic("0x8888888888888888888888888888888888888888")],
      data: encodeAbiParameters([{ type: "uint256" }], [100n]),
    };
    const { deltas } = decodeDeltasAndApprovals([log], ACCOUNT);
    expect(deltas).toEqual([]);
  });
});

describe("nativeDeltasFromCalls", () => {
  it("one delta per call carrying non-zero value; zero-value calls produce none", () => {
    const deltas = nativeDeltasFromCalls([{ value: 5n }, { value: 0n }, { value: 3n }]);
    expect(deltas).toEqual([
      { kind: "native", amount: 5n, direction: "out" },
      { kind: "native", amount: 3n, direction: "out" },
    ]);
  });
});
