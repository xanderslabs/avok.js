/** ABI of the reference AvokSubnameRegistrar (matches src/AvokSubnameRegistrar.sol). */
export const AvokSubnameRegistrarABI = [
  {
    type: "function",
    name: "registerWithVoucher",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "expiry", type: "uint64" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "label", type: "string" }], outputs: [] },
  { type: "function", name: "parentNode", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "voucherSigner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "resolver", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "openClaim", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "mintFee",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
  },
  {
    type: "function",
    name: "setFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_feeToken", type: "address" },
      { name: "_price", type: "uint256" },
    ],
    outputs: [],
  },
  { type: "function", name: "setTreasury", stateMutability: "nonpayable", inputs: [{ name: "_treasury", type: "address" }], outputs: [] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event",
    name: "MintFeeCharged",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "treasury", type: "address", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SubnameMinted",
    inputs: [
      { name: "node", type: "bytes32", indexed: true },
      { name: "label", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;
