# VERIFICATION.md — @avokjs/react-native

## Unit tests (automated — run in CI)

```
pnpm --filter @avokjs/react-native test
```

Covers:
- `secureStoreStorage` round-trips via injected fake SecureStore (TDD Step 1).
- `secureStoreStorage` localStorage fallback in jsdom environment.
- `AvokProvider` + `useAccount` reactivity with a fake `AvokClient`.
- `useCreate` pending/error state with a fake client (`useSend` is gone — sending goes through the
  EIP-1193 provider, not a hook).
- `useLogin` / `useLogout` pending, error and sync-void-return handling.
- `AvokProvider` resync when the `client` prop identity changes (PROV-1).
- `useEnroll` / `useExport` / `useAccessSlots` management verbs, including the optimistic remove.
- `useSelfCustody` throwing on a use-only client.
- `createOwnOriginConnection`: the required-`passkey` refusal, that construction never fires the
  passkey module (no biometric prompt on app launch), and the storage default/override.
- `createAvokClient` provider wiring: the client keeps the core surface, the EIP-1193 provider is
  DOM-free and stable across calls, the operator's identity is announced and no Avok brand is
  substituted, and construction survives having no `window` at all.
- `usePairingCeremony` phase machine (SAS gate, camera-error retry, reject) over a fake transport.
- `createExpoCameraTransport` permission + barcode→promise bridge over a fake injected camera module.

## Device-gated checks (require a real iOS/Android device with Expo)

The following behaviours CANNOT be verified in unit tests — they require a physical
device or a capable emulator with biometrics and platform authenticators.

### 1. Real RN passkey (Face ID / Touch ID / Fingerprint)

```tsx
import { Passkey } from "react-native-passkey";   // or your provider
import { createOwnOriginConnection } from "@avokjs/react-native";

const connection = createOwnOriginConnection({ rpId: "app.example.com", passkey: Passkey });
await connection.create();   // should invoke Face ID / Touch ID prompt
await connection.continue(); // discover + PRF-decrypt
```

Expected: biometric prompt appears; `create()` and `continue()` resolve without error.

### 2. Real SecureStore (expo-secure-store encrypted keychain)

```tsx
import * as SecureStore from "expo-secure-store";
import { secureStoreStorage } from "@avokjs/react-native";

const storage = secureStoreStorage({ secureStore: SecureStore });
await storage.set("test-key", "test-value");
const v = await storage.get("test-key");
console.assert(v === "test-value", "SecureStore round-trip failed");
await storage.remove("test-key");
```

Expected: value survives the round-trip from the Keychain (iOS) or Keystore (Android).

### 3. Bundle purity check

In a React Native (Metro) or Expo (hermes) build, verify that the bundle contains no `react-dom`
(`tsup.config.ts` externalizes it and builds `platform: "neutral"`) — check the Metro bundle output or
a source-map explorer.

There is no shared-origin check to run here. This package is own-origin only, and
`@avokjs/shared-origin` no longer exists as a package — it was collapsed into `@avokjs/core`.

### 3b. PRF inside an in-app browser tab (DONE — 2026-07-20)

Recorded because it is expensive to reacquire and documented nowhere public. A WebAuthn ceremony
requesting the PRF extension was run on real hardware inside **iOS ASWebAuthenticationSession** and
**Android Chrome Custom Tabs**. PRF returned key material on BOTH. That is the feasibility gate for
native shared-origin — Avok derives the wallet key from PRF, so a container that strips the extension
would have ruled the approach out entirely.

Re-run this if the minimum supported OS moves, or if a platform ships a WebAuthn change: load a PRF
test page (or the operator's own auth page, which exercises the real adapter) inside each container
via `expo-web-browser`'s `openAuthSessionAsync`, register, then authenticate, and confirm PRF is
non-empty rather than `NoPrfError`. iOS floor is **18.0** — PRF shipped in Safari 18.0, not 18.4.

### 4. Real camera QR pairing (`createExpoCameraTransport`)

Unit tests exercise the transport's permission + barcode→promise bridge with a fake camera. On a
physical device with `expo-camera`, verify the full ceremony over a real camera:
- `usePairingCeremony({ role, transport: createExpoCameraTransport(Camera) })`, rendering a QR of
  `transport.currentCode` and a `<CameraView onBarcodeScanned={e => transport.feedBarcode(e.data)} />`
  while `transport.isScanning`.
- Camera-permission denial surfaces the `camera-error` phase; granting + retry resumes the scan.
- A full import↔export pairing between two devices writes the new device's access slot on chain.
