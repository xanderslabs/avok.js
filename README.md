# Avok

Avok (`avok.js`) is an open-source, client-side SDK for **passkey-authenticated,
self-custodial smart wallets** on **EVM**. No seed phrase, no browser extension, and no
vendor servers in the signing path. Every wallet is a smart EOA through
[EIP-7702](https://eips.ethereum.org/EIPS/eip-7702), delegated to
[`AvokCalibur`](contracts/src/AvokCalibur.sol), a thin subclass of Uniswap's audited
[Calibur](https://github.com/Uniswap/calibur).

> **Status:** pre-audit, pre-1.0. A chain is claimed "supported" only after the fork
> end-to-end suite passes against it (the receipts gate); every registered chain is
> `"unverified"` until that run is green. Track releases in each package's CHANGELOG.

## The passkey is the wallet

The wallet's root key is derived from the passkey itself, `K = HKDF(PRF(credential))`,
inside the Vault for each signing gesture, then wiped. It is never stored and never
exported. The passkey (P256) never signs on-chain; what signs is always a secp256k1 key
verified by `ecrecover`. Additional devices register their own derived keys in the
wallet's on-chain key roster.

## One origin-point

Every app configures a single `originPoint`: the URL of a static Vault page an operator
hosts (built with `avok-vault`). All key operations happen inside that page, in a popup
the SDK opens: derivation, consent, signing. Consent decodes what it signs from the
bytes themselves, and an unrecognized call is shown as raw calldata, never hidden. The Vault
also carries transaction simulation and asset-delta preview as a module
(`eth_simulateV1` against the operator's own pinned RPC), tested standalone; wiring it
into the consent screen itself is in progress. An app can run its own origin-point or,
permissionlessly, point at someone else's, and its users sign in with the wallets they
already have there. The page is static and re-hostable; there is nothing of Avok's to go
down.

## Recovery

Wallet control changes only through a public, vetoable timelock. Recovery is M-of-N
guardian approvals (a friend's wallet, a hardware key, or a written-down recovery key),
a 24-hour delay any live signer can veto, then the new key joins the roster of the same
address: assets never move. Guardians hold no transaction power. The contracts (setup,
propose/execute/veto, approval, promotion) are live and tested on-chain; the Vault's own
"Recover a wallet" screen that drives that flow end-to-end is in progress. See
[`contracts/SECURITY.md`](contracts/SECURITY.md) for the model and its stated limits.

## Packages

| Package | Purpose |
| --- | --- |
| [`@avokjs/core`](packages/core) | The framework-agnostic SDK and the plain-JS/browser SDK. |
| [`@avokjs/react`](packages/react) | React lifecycle hooks and components. |
| [`@avokjs/react-native`](packages/react-native) | React Native hooks plus the native passkey adapter. |
| [`@avokjs/vault`](packages/vault) | The origin-point builder CLI: emits the static Vault page and its security headers. |
| [`@avokjs/contracts`](contracts) | Published addresses, ABIs, and EIP-712 types the SDK consumes. |

## Bring your own infrastructure

Gas sponsorship is the developer's choice, per send, through your own ERC-7677 paymaster
and ERC-4337 bundler; nothing is sponsored by default and Avok operates none of it.
Sending and signing go through the announced EIP-1193 provider, driven by stock wagmi,
viem, and ethers. There is no `useSend` hook. Chain RPC endpoints are pinned into the
Vault at build time; a chain is documented as supported only after the end-to-end suite
passes against it.

## License

MIT.
