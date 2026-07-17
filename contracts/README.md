# @avokjs/contracts

Solidity contracts and ABI metadata for Avok EIP-7702 wallets. Publishes both the compiled JS bindings (for backends and frontends) and the raw `.sol` sources (for adopters who want to build or audit them with Foundry).

```bash
npm install @avokjs/contracts
```

## Wallet implementation

`AvokWalletImplementation` is the contract you delegate to via EIP-7702. It uses OpenZeppelin primitives for signature recovery, ERC-1271, and the safe-receive holders.

Supported receive surfaces:

- Native gas token through `receive()`.
- ERC-20 transfers through the standard balance model. ERC-20 has no receiver hook.
- ERC-721 safe transfers through `ERC721Holder`.
- ERC-1155 single and batch safe transfers through `ERC1155Holder`.
- ERC-777 sender and recipient hooks after the wallet registers itself in ERC-1820.

ERC-777 / ERC-1820 support is opt-in per wallet. Call `registerERC1820Interfaces()` through a wallet self-call to enable it, and `unregisterERC1820Interfaces()` to remove it.

## ABI imports

```ts
import { walletAbi, accessSlotAbi, executeBatchSignedAbi } from "@avokjs/contracts";
```

## Building locally

The repo ships Foundry sources. From the package directory:

```bash
forge build
forge test --offline --disable-labels
```

## Status

Unaudited. Slither baseline is clean. OpenZeppelin components reduce custom surface but do not make the composed wallet production-safe.

## License

MIT.
