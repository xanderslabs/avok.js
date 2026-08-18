---
"@avokjs/core": minor
---

Two new internal modules, both consumed by the origin-point Vault rather than exported from the
package: transaction simulation and guardian-recovery flow control.

- **`vault/simulate`** wires `eth_simulateV1` (falling back to `status: "unsimulated"` on a chain
  that lacks it, with reverts blocking rather than hiding the send) into the consent screen: what a
  batch is about to move is decoded from the transaction itself and shown as asset-delta rows, not
  taken on trust from the calldata's own labels.
- **`vault/recover`** drives the guardian-recovery UI end to end: read a wallet's guardian config
  and any pending recovery, collect a guardian's EIP-712 approval, and reach execute or veto.

Neither is part of `@avokjs/core`'s public subpath exports (see the vault README's recovery screen,
and the roster-and-guardian-management changeset for the on-chain calldata builders these two
modules call into).
