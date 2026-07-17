# VERIFICATION.md — @avokjs/react-native

## Unit tests (automated — run in CI)

```
pnpm --filter @avokjs/react-native test
```

Covers:
- `secureStoreStorage` round-trips via injected fake SecureStore (TDD Step 1).
- `secureStoreStorage` localStorage fallback in jsdom environment.
- `AvokProvider` + `useAccount` reactivity with a fake `AvokClient`.
- `useSend` + `useCreate` pending/error state with a fake client.

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

In a React Native (Metro) or Expo (hermes) build, verify that:
- Calling only `createOwnOriginConnection` does NOT pull `@avokjs/shared-origin` into
  the bundle (check Metro bundle output / source-map explorer).
- Calling `createSharedOriginConnection` DOES add the network chunk.
