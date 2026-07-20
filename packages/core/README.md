# @avokjs/core

The framework-agnostic Avok SDK, and also the plain-JS/browser SDK. **The passkey *is* the wallet**:
`K = HKDF(PRF(credential, rpId))`, derived on every use and stored nowhere.

```bash
npm i @avokjs/core
```

`@avokjs/core` has no framework dependency. The React and React Native packages are thin layers over
it.

## Quickstart

```ts
import { createAvokClient, createOwnOriginConnection } from "@avokjs/core";

const client = createAvokClient(
  { connection: createOwnOriginConnection({ rpId: "example.com" }) },
  // The operator's identity, shown in wallet pickers. `name` and `rdns` are required and are never
  // defaulted to an Avok brand.
  { name: "Example Wallet", rdns: "com.example.wallet" },
);

const account = await client.create();       // runs the passkey ceremony
const provider = client.getEip1193Provider();
```

`createAvokClient(config, wallet)` returns a client with the wallet lifecycle surface and an
announced EIP-1193 provider (EIP-6963) plus a Solana Wallet Standard wallet.

## Sending and signing are not on the client

The client does **not** expose a `send` method. Sending and signing go through the announced
EIP-1193 provider and the Solana Wallet Standard wallet, driven by stock wagmi, viem, ethers, or
`@solana/wallet-adapter`. `client.getEip1193Provider()` hands you the provider for direct use.

## Subpaths

| Subpath | Purpose |
| --- | --- |
| `@avokjs/core` | Browser-wired surface: `createAvokClient`, connection factories, `webStorage`, errors. |
| `@avokjs/core/engine` | Full framework-agnostic surface, no browser globals. The React Native base. |
| `@avokjs/core/provider` | EIP-1193 provider, EIP-6963 announce, Solana Wallet Standard registration. |
| `@avokjs/core/wallet` | Wallet primitives: encoding, blob crypto, passkey adapters, signing verbs, access-vault ABI. |
| `@avokjs/core/evm` | EVM engine types and building blocks: receipts, bundler, ERC-7677 paymaster, userOp builder. |
| `@avokjs/core/solana` | Solana engine types and building blocks: receipts, RPC client, Kora client, SPL builders. |
| `@avokjs/core/decode` | Solana transaction decoding for consent screens. |
| `@avokjs/core/channel` | The client half of the shared-origin channel, with web and native transports. |
| `@avokjs/core/helpers` | Name resolution, balances, chain metadata, and the QR pairing ceremony. |
| `@avokjs/core/qr` | The browser QR pairing transport. |
| `@avokjs/core/pairing-window` | A `postMessage` pairing transport for two origins on one device. |
| `@avokjs/core/auth-popup` | The mountable behind the shared-origin popup page an `rpId` owner hosts. |
| `@avokjs/core/internal` | A cross-package seam for the provider layer. Not application API. |

## Configuration

Pass a `ClientConfig` as the first argument. Key fields: `connection` (required), `rpcUrls`,
`paymasterUrl` and `bundlerUrl` (EVM sponsorship, required together), `koraUrl` (Solana
sponsorship), and `requireSponsorship`. Avok ships **no default** RPC, bundler, paymaster, or Kora
endpoint. Each one is a trust boundary you supply. For the full sponsorship contract, including
custom `Bundler`, `Paymaster7677`, and `KoraClient` injection, see [`SPONSORED.md`](./SPONSORED.md).

## Documentation

Full documentation lives in the repo's [`docs/`](../../docs) site: tutorials, concepts, guides, and a
complete API reference.
