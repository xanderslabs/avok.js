# Avok

Avok (`avok.js`) is an open-source, client-side SDK for **passkey-authenticated, self-custodial
smart wallets** on **EVM and Solana**. There is no seed phrase and no browser extension. EVM wallets
are smart EOAs through [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702), and Solana is a
first-class second rail.

## The passkey is the wallet

The wallet key is derived from the passkey itself, `K = HKDF(PRF(credential, rpId))`, for each
signing gesture, then wiped. It is never stored. Because `rpId` scopes the passkey's PRF, it is an
input to the key: change the `rpId`, and every user gets a different wallet.

## Two signing paths

The passkey's WebAuthn `rpId` decides how signing happens, and you select the path through
configuration:

- **Own-origin**: the passkey's `rpId` is the app's own origin, so signing runs in-app. Set `rpId`.
- **Shared-origin**: the passkey lives under a different origin, so signing runs in a popup (web) or
  an in-app browser tab (React Native). Set `authOrigin`.

## Packages

| Package | Purpose |
| --- | --- |
| [`@avokjs/core`](packages/core) | The framework-agnostic SDK and the plain-JS/browser SDK. |
| [`@avokjs/react`](packages/react) | React lifecycle hooks and components. |
| [`@avokjs/react-native`](packages/react-native) | React Native hooks plus the native passkey and SecureStore adapter. |
| [`@avokjs/contracts`](contracts) | Published addresses, ABIs, and EIP-712 types the SDK consumes. |

Install `@avokjs/core` for a plain-JS app, `@avokjs/react` for React web, or `@avokjs/react-native`
for React Native and Expo.

## Bring your own infrastructure

Avok ships **no default** RPC, bundler, paymaster, or Kora endpoint. Each one is a trust boundary you
choose. Sending and signing go through the announced EIP-1193 provider and the Solana Wallet
Standard, driven by stock wagmi, viem, and `@solana/wallet-adapter`. There is no `useSend` hook.

## Documentation

Full documentation lives in [`docs/`](docs): tutorials, concepts, guides, and reference. Start with
[What is Avok?](docs/get-started/what-is-avok.mdx).

## License

MIT.
