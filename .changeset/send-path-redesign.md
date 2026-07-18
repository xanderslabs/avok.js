---
"@avokjs/core": minor
"@avokjs/react-native": minor
---

Send-path redesign: thin the transaction path onto standard tooling, and standardize the
sponsored-gas rail vocabulary. (The surfaces below were consolidated into `@avokjs/core` by the
package restructure — see the restructure changeset; the semantics are unchanged.)

- **Rail terminology `fronted` → `sponsored`** (both EVM and Solana). User-visible surface changes:
  - `Receipt.rail` is now `"self-pay" | "sponsored"` (was `"fronted"`); the consent/fee disclosure
    and capability plumbing follow (`@avokjs/core`, `@avokjs/react-native`).
  - The shared-origin popup signer verb `signFronted` is renamed `signSponsored`
    (`@avokjs/core/channel`).
  - The auth-popup consent copy says "Sponsored" instead of "Fronted" (`@avokjs/core/auth-popup`).
- **`classifySendError()` — BREAKING:** the `SendErrorKind` value `"fronted-unavailable"` is renamed
  `"sponsored-unavailable"` (`@avokjs/core/helpers`). Consumers matching on the old value must update.
  The relayer's external `RELAYER_REASON` wire keys (e.g. `not_fronted`) are unchanged.
- **Oracle retired:** the private `@avokjs/oracle` package is deleted; the sponsored consent fee is now
  sourced from the ERC-7677 paymaster/gas quote (no USD oracle conversion).

No contract changes; the wallet lifecycle surface (`create`/`login`/`logout`/account/access-key/export)
is unchanged.
