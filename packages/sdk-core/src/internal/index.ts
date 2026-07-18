// @avokjs/sdk-core/internal — the cross-package seam the provider imports. NOT part of the
// public client surface; exposes the send engine relocated out of the (soon-deleted) client.evm namespace.
export { createSendEngine } from "./send.js";
export type { SendEngine } from "./send.js";
export { createSolanaEngine } from "./solana-send.js";
export type { SolanaEngine, SolanaCluster } from "./solana-send.js";

// The sponsored UserOp assembly, exposed for the #9 acceptance harness
// (examples/scripts/acceptance-evm-sponsored). It is the flow #4 shipped — including the stub-7702
// authorization the bundler needs to simulate against a delegated account — so the gate must drive
// THIS, not a lookalike. A harness that re-derived the assembly would prove its own copy works
// against a real bundler, not that the SDK's does.
//
// Additive and behaviour-free: `internal` already exists to be imported across the package
// boundary, and this adds nothing to the PUBLIC client surface.
export {
  prepareSponsoredUserOp,
} from "../client/sponsored-userop.js";
export type {
  SponsoredInfra,
  PreparedSponsoredUserOp,
} from "../client/sponsored-userop.js";
