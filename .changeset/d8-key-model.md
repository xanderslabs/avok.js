---
"@avokjs/core": minor
---

The D8 key model: `K = HKDF(PRF(passkey))`, derived per gesture and wiped, with no more PRF-blob/SAS
enrolment scheme.

**Breaking (pre-1.0, pre-audit).** Pre-1.0, a breaking change bumps the MINOR: `0.1.0` to `0.2.0`.

- **`@avokjs/core/wallet` drops the whole PRF-blob/SAS-pairing surface**: `deriveSlotId`,
  `encodeAccessHandle`, `decodeUserHandle`, `UserHandle`, `decryptKeyBlob`, `serializeBlob`,
  `deserializeBlob`, `BLOB_BYTES`, `EncryptedKeyBlob`/`BlobVersion`, `META_BYTES`, `ExportedWallet`,
  `addPasskey`, `exportWallet`, `reconstructFromKey`, `reconstructWalletState`, `ACCESS_VAULT_ABI`,
  `buildAddAccessSlotCall`, `buildRemoveAccessSlotCall`, `VaultUnreadableError`, `listAccessSlots`,
  `AccessSlotEntry`/`RosterReader`, `readAccessSlotRpId`, `vaultForChainFromRegistry`, `resolveBlob`,
  `BlobSource`/`ResolveBlobResult`, `AccessSlotOffer`/`AccessSlotWrap`, and the wallet-scoped
  `Call`/`VaultReader` types. That whole ceremony — wrap the shared key under a second device's PRF
  and ship the ciphertext on chain — is gone; K never travels between devices under any scheme now.
- **`WalletState` no longer carries blob/slot fields.** A device's local state is just its own
  derived address, its credential id, and (for a non-founding device) the wallet address it signs
  for — there is no more multi-slot roster in local state, because there is no more shared key for
  multiple slots to decrypt their way to.
- **New: `createDeviceEnrollmentRequest`/`verifyDeviceEnrollmentRequest`.** A new device derives its
  own independent key (never a copy of anyone else's) and proves control of it for a named wallet; an
  existing signer verifies the proof and registers the address on chain (`@avokjs/core/evm`'s
  `buildRegisterDeviceCall` — see the roster/guardian changeset).
