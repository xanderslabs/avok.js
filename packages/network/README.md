# @avokjs/network

The **shared-origin transport** for Avok: a signing channel (browser popup) that carries requests to an
operator's auth origin, and the account it returns.

**No server, no OIDC, no tokens, no session.** The popup runs the passkey ceremony and posts the
account back. That is the whole handshake.

Most apps do not import this directly — [`@avokjs/vanilla`](https://www.npmjs.com/package/@avokjs/vanilla),
[`@avokjs/react`](https://www.npmjs.com/package/@avokjs/react) and
[`@avokjs/react-native`](https://www.npmjs.com/package/@avokjs/react-native) wire it for you.
Reach for it when you are building your own facade.

```ts
import { createSharedOriginConnection, createWebChannel } from "@avokjs/network";

const connection = createSharedOriginConnection({
  authOrigin: "https://wallet.example.com",
  channel: createWebChannel({ authOrigin: "https://wallet.example.com" }),
});

await connection.connect();                       // popup → passkey → account
await connection.signMessage({ message: "gm" });  // popup → consent → signature
```

`storage` is optional and defaults to in-memory; pass one (e.g. `memoryStorage()`, or your own
`StorageAdapter` over `localStorage`) to survive a reload without re-prompting.

## What it holds

An **account**, not a session:

```ts
type SharedAccount = { evmAddress: Address; solanaAddress?: string; credentialId?: string };
```

There is nothing secret in it and nothing to steal. The address needs no proof, because **a hostile
popup could only make your app DISPLAY a wrong address — it cannot sign.** Every signature requires a
fresh passkey gesture on the user's device plus their approval of a consent screen, and no key material
ever crosses this boundary: the operator's popup derives the wallet key from the passkey, signs, and
discards it. Your app receives a signature.

## Why there is no PKCE or `state`

Those exist to protect a redirect through the address bar. This is not a redirect — the channel pins
both the **origin it opened** and the **exact window it opened**, and the popup posts the account
straight back. Nothing travels through a URL, so there is no code to intercept and no token to mint.

## Errors

```ts
import { UserRejectedError, throwIfSignError } from "@avokjs/network";
```

A refusal is **thrown**, never returned as a signature-shaped object.

## Surface

| | |
|---|---|
| `createSharedOriginConnection({ authOrigin, channel, storage? })` | the connection |
| `connect()` / `account()` / `status()` / `logout()` | lifecycle |
| `signMessage` / `signTypedData` / `signSiwe` / `signSend` | signing (the `Signer` contract) |
| `createWebChannel({ authOrigin })` | the browser popup channel |
| `memoryStorage` / `saveAccount` / `loadAccount` / `clearAccount` | storage |
| `UserRejectedError` / `throwIfSignError` | errors |

`logout()` forgets the account locally. There is no server to tell — nothing was ever stored there.
