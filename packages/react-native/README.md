# @avokjs/react-native

Avok for React Native / Expo. **The passkey *is* the wallet** — `K = HKDF(PRF(credential, rpId))`,
derived on every use and stored nowhere.

```bash
npm i @avokjs/react-native react react-native expo-secure-store
```

Peer deps: `react`, `react-native`, `expo-secure-store`. Passkeys require a PRF-capable provider
(iCloud Keychain, Google Password Manager).

```tsx
import {
  AvokProvider, createAvokClient, createOwnOriginConnection, secureStoreStorage, useAccount,
} from "@avokjs/react-native";

const client = createAvokClient({
  connection: createOwnOriginConnection({
    rpId: "example.com",              // explicit — it is an input to the wallet key
    storage: secureStoreStorage(),
  }),
});

export default () => (
  <AvokProvider client={client}>
    <Wallet />
  </AvokProvider>
);
```

The hook surface matches [`@avokjs/react`](https://www.npmjs.com/package/@avokjs/react).

## Shared-origin

Native uses an auth session (`ASWebAuthenticationSession` / Custom Tabs) with a deep-link redirect
instead of a popup:

```tsx
import * as WebBrowser from "expo-web-browser";
import { createSharedOriginConnection } from "@avokjs/react-native";

const connection = await createSharedOriginConnection({
  authOrigin: "https://wallet.example.com",
  redirectUri: "myapp://callback",
  redirectScheme: "myapp",
  openAuthSession: async (url, scheme) => {
    const r = await WebBrowser.openAuthSessionAsync(url, `${scheme}://callback`);
    if (r.type !== "success") throw new Error("Sign-in cancelled");
    return r.url;
  },
});
```

`@avokjs/shared-origin` is imported **dynamically** inside `createSharedOriginConnection`, so a
own-origin-only app never pulls the shared-origin chunk.

## Status

The native channels are unit-tested; the **RN demo apps are not in scope** and the native
auth-session redirect has not been exercised on a device. Treat this package as functional but
less-travelled than the web facades — see `VERIFICATION.md`.

## Removing a device's access

Pairing gives the other device **its own key to this wallet**, wrapped under **its own passkey**. The
SDK never keeps `K` at rest — it is derived per gesture and wiped immediately after (`wipeSecrets`), so
a device's lasting access is exactly *its passkey* plus *its encrypted access slot on chain*.

`listAccessSlotsWithDomains()` enumerates the access slots — each with the domain that enrolled it, so
you can tell them apart — and `removeAccessSlot(slotId, { confirm: true })` deletes one. On a faithful
client this **denies future access**: without its blob there is nothing left for that passkey to
decrypt, so it cannot reconstruct the key on a fresh session.

**Removal is housekeeping, not revocation**, and no UI may present it as a security control. It cannot
*guarantee* the key was never kept — a device compromised or running a modified ceremony *while in use*
could have exfiltrated `K` live, and no on-chain action un-copies it. The blob was public calldata and
stays in chain history forever; and because every passkey signs as the same `K`, any passkey can remove
any other. So:

> **If a paired device is lost or compromised, removal is not enough — move your funds to a new wallet.**

Tell your users that *before* they pair, and only pair devices you control.
