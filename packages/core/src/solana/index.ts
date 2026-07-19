// This barrel is the internal API boundary for non-solana core code AND the public `@avokjs/core/solana`
// subpath. It does NOT re-export the low-level internals (per-signature/rent constants, the ATA-exists
// probe, the base `simulateSolana` variant, the priority-fee selection mechanics): those are reached via
// deep imports inside this folder. Add a symbol here only when a cross-module consumer needs it. The
// consent/decode surface is its own `@avokjs/core/decode` subpath, not re-exported from here.
export type { Rail, SolanaExecutionContext, DecodedInstruction, FeeBreakdown, SolanaNativeFeeEstimate, SimulationConfidence, SimulationResult, ReceiptStatus, Receipt } from "./types.js";
export { railFromContext } from "./types.js";
export type { SolanaRpcClient, LatestBlockhash, SimResult } from "./rpc.js";
export { createSolanaRpcClient } from "./rpc.js";
// The option type of the createSolanaRpcClient factory above (its priority-fee knob); the selection
// mechanics stay module-private in priority-fee.ts.
export type { PriorityFeePolicy } from "./priority-fee.js";
export { toKitSigner, toRemoteKitSigner } from "./signer.js";
export { associatedTokenAddress, buildSplTransfer } from "./spl.js";
export { estimateSolanaNativeFee } from "./pricing.js";
export type { FeePayer } from "./build.js";
export { buildSolanaMessage } from "./build.js";
export { simulateSolanaMessage } from "./simulate.js";
export { sendSolana } from "./send.js";
export type { FetchLike, KoraClient, KoraFeeQuote } from "./kora.js";
export { createKora, KoraRejectedError } from "./kora.js";
export { buildKoraFeePayment } from "./kora-fee.js";
export { getReceiptStatus } from "./track.js";
export { encodeOffchainMessage } from "./offchain-message.js";
