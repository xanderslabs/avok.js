# @avokjs/react-native

## 0.1.0

### Minor Changes

- 9419676: First release. React Native lifecycle and management hooks (`useEnroll` / `useExport` /
  `useAccessSlots`), `createAvokClient(config, wallet)`, and the native platform adapter (native
  passkey + SecureStore), all over `@avokjs/core/engine`. Pairing: `usePairingCeremony()` +
  `createExpoCameraTransport()`, with the camera injected. Never statically imports `react-native`
  or `expo-*`.

- 75d96cd: The sponsored-gas rail is named `sponsored` throughout: `Receipt.rail` is
  `"native-gas" | "sponsored"`, and the consent/fee disclosure and capability plumbing follow.

### Patch Changes

- Updated dependencies [9419676]
- Updated dependencies [75d96cd]
  - @avokjs/core@0.1.0
  - @avokjs/contracts@0.1.0
