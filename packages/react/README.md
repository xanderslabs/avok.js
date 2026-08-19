# @avokjs/react

React bindings for Avok. **The passkey *is* the wallet**: `K = HKDF(PRF(credential))`, derived inside
the origin-point Vault on every gesture and stored nowhere.

```bash
npm i @avokjs/react react
```

Peer dependency: `react >=19.2.7`.

## Quickstart

```tsx
import { AvokProvider, createAvok, useAccount, useLogin } from "@avokjs/react";

const client = await createAvok({
  originPoint: "https://vault.example.com", // yours, or someone else's (permissionless)
  chains: ["base"],
  wallet: { name: "Example Wallet", rdns: "com.example.wallet" }, // shown in wallet pickers
});

function Wallet() {
  const { account } = useAccount();
  const { login, pending, error } = useLogin();
  if (!account) {
    return (
      <button disabled={pending} onClick={() => login()}>
        Connect
      </button>
    );
  }
  return <p>{account.evm.address}{error && <span>{error.message}</span>}</p>;
}

export default function App() {
  return (
    <AvokProvider client={client}>
      <Wallet />
    </AvokProvider>
  );
}
```

There is no passkey domain or auth-server URL to set on the SDK side. Every app configures a single
`originPoint`, the URL of the operator's Vault page, and the SDK opens a popup there for every
wallet action.

## Hooks

Each mutation hook returns `pending` and `error` next to its action, so a failed passkey gesture or a
rejected signature surfaces where you render it.

| Hook | What it does |
| --- | --- |
| `useAvok` | Returns the client. |
| `useAccount` | Reactive `{ account, status }` snapshot. |
| `useLogin` | Open the origin-point popup and connect. |
| `useLogout` | End the session. |
| `useAvokConnect` | The WalletConnect-style connect trigger: `{ connect, isPending, isConnected, account, error }`. |
| `useDevices` | Read the device roster; build (not send) register/revoke calls. |
| `useGuardians` | Read the guardian set and any pending recovery; build (not send) setup/propose/execute/veto calls. |

Components: `AvokProvider`, `AuthPopup` (mount the Vault ceremony as a React tree instead of the
plain-DOM entry, for an operator building their own Vault page in React), `SharedOrigin` (the async
wiring for a popup-backed connection). Exact return shapes are in the hooks' own TSDoc.

## Sending and signing are not hooks

`createAvok` announces an EIP-1193 provider over EIP-6963. You send and sign with the stock ecosystem
tools, wagmi, viem, ethers or RainbowKit, which discover Avok like any other wallet.
`client.getEip1193Provider()` returns the provider directly if you are not using a connector library.

`useDevices`/`useGuardians` follow the same rule: they build a `{ to, value, data }` self-call. Device
registration and guardian-set changes are ordinary wallet transactions, and you send it through the
provider, exactly like any other action. Neither hook signs or submits anything itself.

## Devices and guardians

Enrolling a new device (`@avokjs/core/wallet`'s `createDeviceEnrollmentRequest`, run on the NEW
device) and registering it on chain (`useDevices().buildRegisterCall`, sent from an EXISTING device)
are two separate steps a UI composes; there is no bundled pairing ceremony in this package. A
guardian's own *approval* of a recovery is a different action again (their key, not the wallet's), and
runs on the origin-point's own recovery screen, not through this SDK. `useGuardians` is for the
wallet OWNER managing who their guardians are, not for a guardian to act.

## Documentation

This package is a thin React layer over [`@avokjs/core`](../core). See that package's README for the
underlying config, subpaths, and the sponsorship contract.
