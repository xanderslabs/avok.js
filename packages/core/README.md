# @avokjs/core

The framework-agnostic Avok SDK, and also the plain-JS/browser SDK. **The passkey *is* the wallet**:
`K = HKDF(PRF(credential))`, derived inside the origin-point Vault on every gesture and stored
nowhere.

```bash
npm i @avokjs/core
```

`@avokjs/core` has no framework dependency. The React and React Native packages are thin layers over
it.

## Quickstart

```ts
import { createAvok } from "@avokjs/core";

const client = await createAvok({
  originPoint: "https://vault.example.com", // yours, or someone else's (permissionless)
  chains: ["base"],
  wallet: { name: "Example Wallet", rdns: "com.example.wallet" }, // shown in wallet pickers
});

const account = await client.login();        // opens the origin-point popup
const provider = client.getEip1193Provider();
```

There is no passkey domain or auth-server URL to set on the SDK side. Those are the origin-point's
own build-time configuration (`avok-vault init`), never this SDK's, whether the current app IS the
origin-point's first party or a guest changes nothing here.

## Sending and signing are not on the client

The client does **not** expose a `send` method. Sending and signing go through the announced
EIP-1193 provider, driven by stock wagmi, viem, ethers, or RainbowKit.
`client.getEip1193Provider()` hands you the provider for direct use.

## Subpaths

| Subpath | Purpose |
| --- | --- |
| `@avokjs/core` | Browser-wired surface: `createAvok`, `createAvokClient`, `createSharedOriginConnection`, `webStorage`, errors. |
| `@avokjs/core/engine` | Full framework-agnostic surface, no browser globals. The React Native base. |
| `@avokjs/core/provider` | EIP-1193 provider and EIP-6963 announce. |
| `@avokjs/core/wallet` | Wallet primitives: passkey adapters, `createWallet`, device enrollment, signing verbs. |
| `@avokjs/core/evm` | EVM engine: receipts, bundler, ERC-7677 paymaster, userOp builder, device-roster and guardian-set call builders and reads. |
| `@avokjs/core/channel` | The client half of the origin-point popup channel, with web and native transports. |
| `@avokjs/core/helpers` | Name resolution, balances, chain metadata. |
| `@avokjs/core/qr` | The browser QR transport primitive. |
| `@avokjs/core/auth-popup` | The mountable behind the origin-point Vault page. |
| `@avokjs/core/internal` | A cross-package seam for the provider layer. Not application API. |

## Device management and guardians

`@avokjs/core/evm` exports pure call builders and reads: `buildRegisterDeviceCall`/
`buildRevokeDeviceCall`/`readDeviceRoster` for who can sign, and `buildSetupGuardiansCall`/
`buildProposeGuardianOpCall`/`buildExecuteGuardianOpCall`/`buildVetoGuardianOpCall`/
`readGuardianState` for who can recover the wallet. Both device registration and guardian-set changes
are ordinary wallet self-calls (`onlyThis` on the wallet contract): build the `Call`, then send it
through the EIP-1193 provider like any other transaction. There is no bespoke signing primitive for
either, and the React/React Native `useDevices`/`useGuardians` hooks are thin wrappers over exactly
these functions.

A guardian's own *approval* of a recovery is a different action (their key, not the wallet's), and it
runs on the origin-point's own recovery screen, not through this SDK. See the
[`@avokjs/vault`](../vault) README.

## Configuration

`createAvok({ originPoint, chains, wallet, sponsorship? })` is the one-call factory. For hand-wiring a
custom `ClientConfig` (a custom channel transport, for example), `createAvokClient({ connection, ...
})` takes `rpcUrls` and `paymasterUrl`/`bundlerUrl` (required together) directly. Sponsorship is asked
for per send, never configured as a client-wide default. Avok ships **no default** RPC, bundler, or
paymaster. Each is a trust boundary you supply. See [`SPONSORED.md`](./SPONSORED.md) for the full
sponsorship contract, including custom `Bundler`/`Paymaster7677` injection.
