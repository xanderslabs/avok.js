# @avokjs/react

## 0.1.0

### Minor Changes

- 9419676: First release. React lifecycle hooks and components over `@avokjs/core`: `AvokProvider`
  plus account/lifecycle hooks, the management hooks (`useEnroll` / `useExport` / `useAccessSlots`),
  `<AuthPopup>`, `<SharedOrigin>` / `useAvokConnect()`, and `usePairingCeremony()` / `<PairDevice>`.

  Sending and signing are not hooks: they go through the EIP-1193 provider and the Solana Wallet
  Standard wallet that `@avokjs/core` announces.

### Patch Changes

- Updated dependencies [9419676]
- Updated dependencies [75d96cd]
  - @avokjs/core@0.1.0
