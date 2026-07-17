# @avokjs/helpers

The batteries an app needs on top of the headless Avok client — balances, chain metadata,
recipient resolution, explorer URLs, amount/tx-status/error helpers, and device-pairing
transport.

Two entry points:

- **`@avokjs/helpers`** — platform-agnostic (no DOM/camera). Runs in the browser,
  React Native, and Node. Balance reads (EVM via viem, Solana via `@solana/kit`), chain
  metadata + display names, `resolveRecipient`, explorer URLs, amount/tx-status/errors, and
  the agnostic pairing driver (`PairingTransport` + `runImportCeremony`/`runExportCeremony`).
- **`@avokjs/helpers/qr`** — browser-only. `createBrowserQrTransport` implements
  `PairingTransport` over the device camera (`qrcode` render + `jsQR` scan). React Native
  ships its own transport against the same interface.
