---
"@avokjs/core": minor
"@avokjs/react": minor
"@avokjs/react-native": minor
"@avokjs/contracts": minor
---

The Solana rail is removed. Avok is EVM-only.

**Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

The `./solana` and `./decode` subpaths, the Solana Wallet Standard entry (`registerAvokSolanaWallet`),
`koraUrl`, `SponsorshipUnavailableError.solana()`, `client.exportSolanaKey()`, SNS name resolution, the
Solana signing verbs, and the Solana chain registry entries are all removed. `K` is now the EVM key: the
key container no longer produces a second curve.

**The account shapes lose a member.** `Account` (`{ evm, solana }`), `AvokAccount`, `AuthPopupAccount`
and `SharedAccount` are all EVM-only now, and `ExportedWallet` narrows from `{ evm, solana }` to
`{ evm }`. Code that destructures the Solana member of any of them stops compiling. `evm` is untouched
in every case, so the fix is to drop the member, never to remap it.

**Two removals reach past the SDK's own surface.** `KoraRejectedError` is gone from all three packages'
catchable-error exports, so an `instanceof` narrowing on it no longer type-checks. And `<SharedOrigin>`
in `@avokjs/react` no longer accepts a `koraUrl` prop.

Also removed, as the rail's dependents: `readSolanaBalances`, `solanaTokens`, `solanaExplorerTxUrl`, and
seven dependencies (`@solana/kit`, the three `@solana-program/*` packages,
`@solana-name-service/sns-sdk-kit`, and both `@wallet-standard/*` packages).

Two signatures narrow because their Solana branch was the only thing they selected between:
`resolveRecipient(resolver, input, rail)` drops `rail` (and the `Rail` type), and
`createNameResolver({ ens, sns })` drops `sns`.

Removable rather than barred: secp256k1 derives an ed25519 key from the same seed, so restoring the
rail later is cheap. The normative `SOLANA_KEY_INFO` HKDF domain and its pinned test vectors are in git
history, and restoring the rail means restoring those exact values rather than re-deriving them, since
they are what make a restored wallet the SAME wallet. ENS resolution is unaffected and stays in scope.
