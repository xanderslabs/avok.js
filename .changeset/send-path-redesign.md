---
"@avokjs/helpers": minor
"@avokjs/shared-origin": minor
"@avokjs/auth-origin": minor
"@avokjs/vanilla": minor
"@avokjs/react-native": minor
---

Send-path redesign: thin the transaction path onto standard tooling, and standardize the
sponsored-gas rail vocabulary.

- **Rail terminology `fronted` → `sponsored`** (both EVM and Solana). User-visible surface changes:
  - `@avokjs/vanilla` / `@avokjs/react-native`: `Receipt.rail` is now `"self-pay" | "sponsored"`
    (was `"fronted"`); the consent/fee disclosure and capability plumbing follow.
  - `@avokjs/shared-origin`: the popup signer verb `signFronted` is renamed `signSponsored`.
  - `@avokjs/auth-origin`: the popup consent copy says "Sponsored" instead of "Fronted".
- **`@avokjs/helpers` — BREAKING:** `classifySendError().kind` value `"fronted-unavailable"` is renamed
  `"sponsored-unavailable"` (the `SendErrorKind` union). Consumers matching on the old value must
  update. The relayer's external `RELAYER_REASON` wire keys (e.g. `not_fronted`) are unchanged.
- **Oracle retired:** `@avokjs/oracle` (private) is deleted; the sponsored consent fee is now sourced
  from the ERC-7677 paymaster/gas quote (no USD oracle conversion). Bundled artifacts
  (`@avokjs/vanilla`, `@avokjs/react-native`) no longer carry the oracle graph.

No contract changes; the wallet lifecycle surface (`create`/`login`/`logout`/account/access-key/export)
is unchanged.
