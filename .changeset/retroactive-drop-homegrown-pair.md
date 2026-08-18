---
"@avokjs/contracts": minor
---

Retroactive: the homegrown pairing contract and the zk-email recovery rail are gone, superseded by
the 2026-08-16 doc set (`AvokCalibur`/`GuardianLogic`/D8). This landed on `main` before this branch
(commit `c76fc4a`) with no changeset; recording it now so the CHANGELOG carries it.

**Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

- **`AvokWalletImplementation.sol` and `PasskeyAccessVault.sol` are removed**, along with their
  `IPasskeyAccessVault` interface and the `email-recovery` submodule. `AvokCalibur` is the wallet
  contract now; there is no more a separate implementation/vault split.
- **`contracts/src-ts/index.ts`'s exported ABIs and types change accordingly** — anything generated
  from the removed contracts is gone from the TS export surface.
