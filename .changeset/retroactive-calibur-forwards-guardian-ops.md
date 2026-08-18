---
"@avokjs/contracts": minor
---

Retroactive: `AvokCalibur` now forwards guardian operations to `GuardianLogic` directly; the
zk-email path is removed from the delta. This landed on `main` before this branch (commit
`cefc099`) with no changeset; recording it now so the CHANGELOG carries it.

**Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

- **`AvokRecoveryManager.sol` is removed.** Guardian setup/propose/execute/veto are calls on
  `AvokCalibur` itself (delegatecalled into `GuardianLogic`, per `IAvokCalibur`), not a separate
  recovery-manager contract.
