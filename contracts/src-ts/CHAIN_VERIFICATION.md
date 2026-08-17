# Chain Verification: EIP-7702 status + financial-data (research note)

> **v1 is EVM-only.** The Solana rail was removed on 2026-08-05. Its verified values (the mainnet
> USDC and USDT mints, and the finding that no canonical devnet USDT mint exists) were deleted from
> this note along with the registry entries they documented, because a verification note for chains
> the registry does not carry is exactly the drift this file exists to prevent. Solana is REMOVABLE,
> not barred: git holds both the note's Solana section and the registry entries, so restoring the
> rail means restoring verified values rather than re-researching them.

This note is the pre-registry verification gate for expanding Avok's chain registry from
2 chains (OP, Base) to the full set (Ethereum, Arbitrum One, OP, Base, BSC, Arc testnet).
Every value below was fetched and re-verified this session against the cited
authoritative source. No value was written from memory. Later registry work must copy
values verbatim from this file.

Chains covered: Ethereum (1), Arbitrum One (42161), Optimism (10), Base (8453), BSC (56),
Arc testnet (5042002).

## Step 1: EIP-7702 status per chain

| Chain | Status | Evidence | Source |
|---|---|---|---|
| Ethereum (1) | LIVE | Pectra activated on mainnet 2025-05-07 at epoch 364032 (10:05:11 UTC), includes EIP-7702. | [Ethereum Foundation Pectra Mainnet Announcement](https://blog.ethereum.org/2025/04/23/pectra-mainnet) |
| Arbitrum One (42161) | LIVE | ArbOS 40 "Callisto" brought EIP-7702 to Arbitrum One/Nova. Confirmed independently by Arbiscan's live EIP-7702 Authorizations tracker showing over 11M real authorizations with continuous recent activity (transactions seconds old at fetch time). | [Arbitrum Docs: ArbOS 40 Callisto](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos40); [Arbiscan EIP-7702 Authorizations](https://arbiscan.io/txnAuthList) |
| Optimism (10) | LIVE | Isthmus hardfork (Upgrade 15) activated on the Superchain mainnet 2025-05-09 16:00:01 UTC, bringing Pectra/EIP-7702 to OP Mainnet, Base, and other OP Stack chains. First L2 ecosystem to support Pectra. | [Optimism: Preparing for Pectra breaking changes](https://docs.optimism.io/notices/pectra-changes); [Optimism blog: Optimism Brings Ethereum's Pectra Upgrade to the Superchain](https://www.optimism.io/blog/optimism-brings-ethereum-s-pectra-upgrade-to-the-superchain) |
| Base (8453) | LIVE | Covered by the same Isthmus hardfork as OP Mainnet (Base is an OP Stack chain, activated 2025-05-09). | [Optimism: Preparing for Pectra breaking changes](https://docs.optimism.io/notices/pectra-changes) |
| BSC (56) | LIVE | Pascal hardfork activated on BNB Chain mainnet 2025-03-20 at 02:10 UTC, implementing BEP-441 ("Implement EIP-7702: Set EOA account code"). BNB Chain was one of the first non-Ethereum chains to ship EIP-7702. | [BNB Forum: FAQ about Pascal Hardfork](https://forum.bnbchain.org/t/faq-about-pascal-hardfork/3093); [BSCN: BNB Chain Pascal Hardfork: EIP-7702 Implementation and Updates](https://bsc.news/post/bnb-chain-pascal-hardfork-eip-7702) |
| Arc testnet (5042002) | LIVE | Arc's own EVM-differences reference states verbatim: "EIP-7702 set-code transactions, CREATE2 (including EIP-7610 residual-storage behavior), and EIP-2935 historical block hashes all behave as on Ethereum." Arc additionally advertises native ERC-4337 + EIP-7702 account abstraction support. | [Arc Docs: EVM differences](https://docs.arc.io/arc/references/evm-differences) |
| Arc mainnet | **NOT LIVE** | Arc has not launched a mainnet. Only the testnet (5042002) exists, and it is the only Arc chain in the registry. Revisit when mainnet ships — do not assume the testnet's chain id or addresses carry over. | Founder, 2026-07-22 |

**Gate result: no DROP.** All six chains have EIP-7702 confirmed LIVE on the relevant
network (mainnet for the five EVM L1/L2s, testnet for Arc). BSC ("the one to watch" per
brief) is confirmed live via BEP-441 / Pascal hardfork, activated 2025-03-20, well before
today.

## Step 2: Price feeds — NOT APPLICABLE

Avok wires **no price oracle**. `EvmTokenProfile` is `{address, symbol, decimals}` — it carries no
feed address and no feed id, and nothing in `packages/*/src` reads one. The sponsored rail takes its
number from the ERC-7677 paymaster; the native-gas rail is denominated in the chain's own gas asset,
so there is no currency to convert. An earlier
revision of this note carried Chainlink aggregator addresses and Pyth feed ids for a converter
that no longer exists; they were removed rather than left to rot, since a stale feed address is
worse than none.

Re-open this section only if a rail is added that must convert between assets.

## Step 4: Token addresses + decimals

Fetched from Circle's official contract-address docs, plus each chain's block explorer,
this session.

| Chain | Token | Address | Decimals | Source |
|---|---|---|---|---|
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 | [Circle: USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) (fetched, exact match); [Etherscan](https://etherscan.io/address/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48) |
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 | Well-known canonical Tether mainnet contract; standard 6 decimals |
| Arbitrum One | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | Circle: USDC contract addresses (fetched, exact match); [Arbiscan](https://arbiscan.io/token/0xaf88d065e77c8cc2239327c5edb3a432268e5831) |
| Arbitrum One | USDT (USDT0) | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 | [Arbiscan token page](https://arbiscan.io/token/0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9) (fetched: "Token Contract (WITH 6 Decimals)"); this is USDT0, the LayerZero-canonical Tether representation on Arbitrum, per the plan's decision |
| Optimism | USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | Circle: USDC contract addresses (fetched, exact match); [OP Mainnet Etherscan](https://optimistic.etherscan.io/address/0x0b2c639c533813f4aa9d7837caf62653d097ff85) |
| Optimism | USDT (bridged) | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 | [OP Mainnet Etherscan token page](https://optimistic.etherscan.io/token/0x94b008aa00579c1307b0ef2c499ad98a8ce58e58) (fetched; labeled "Optimism: Bridged USDT Token", 6 decimals confirmed) |
| Base | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | Circle: USDC contract addresses (fetched, exact match); [BaseScan token page](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) (fetched: "Token Contract (WITH 6 Decimals)") |
| Base | USDT (bridged) | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | 6 | [BaseScan token page](https://basescan.org/token/0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2) (fetched directly: "Token Contract (WITH 6 Decimals)" — this corrects an initial search-engine summary that incorrectly claimed 18 decimals by citing a generic OpenZeppelin default; the direct page fetch is authoritative and says 6) |
| BSC | USDC (Binance-Peg) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | [BscScan token page](https://bscscan.com/token/0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d) — "Binance-Peg USD Coin (USDC)", 18 decimals confirmed. Not on Circle's native USDC chain list (BSC is absent from developers.circle.com/stablecoins/usdc-contract-addresses), consistent with this being a Binance-Peg wrapped token, not Circle-native USDC |
| BSC | USDT (Binance-Peg BSC-USD) | `0x55d398326f99059fF775485246999027B3197955` | 18 | [BscScan token page](https://bscscan.com/token/0x55d398326f99059ff775485246999027b3197955) — "Binance-Peg BSC-USD (BSC-USD)", 18 decimals confirmed |

**BSC decimals decision confirmed:** both USDC and USDT on BSC are Binance-Peg tokens at
18 decimals, verified directly on BscScan for both addresses. This is the one chain in the
set that deviates from the 6-decimal USDC/USDT convention.

**Arbitrum USDT0 decision confirmed:** `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` is
USD₮0, the LayerZero-canonical Tether-backed token on Arbitrum, 6 decimals, per Arbiscan.

**Base bridged-USDT decision confirmed:** `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` is
labeled "Bridged Tether USD" on BaseScan (explicitly not issued or redeemable by Tether;
the T-logo is used under license to identify it as a bridged representation), 6 decimals.

### Arc testnet

| Item | Value | Decimals | Source |
|---|---|---|---|
| USDC (native gas token, optional ERC-20 interface) | `0x3600000000000000000000000000000000000000` | 6 | [Arc Docs: Contract addresses](https://docs.arc.io/arc/references/contract-addresses) (fetched: "Optional ERC-20 interface for interacting with the native USDC balance", 6 decimals) |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | 6 | Arc Docs: Contract addresses (fetched) — recorded for completeness, out of scope (fee tokens are USDC/USDT only) |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` | 6 | Arc Docs: Contract addresses (fetched) — recorded for completeness, out of scope |
| USDT | **NOT FOUND** | n/a | Arc's official contract-addresses reference page (fetched this session) lists only USDC, EURC, and USYC. No USDT contract is published for Arc testnet. |

**Arc = USDC-only. No USDT contract found.** The founder should confirm whether this is
expected (Arc may add USDT later, or may intentionally be USDC-only as Circle's own
stablecoin-native chain) before Task 3 proceeds. Do not invent an Arc USDT address.

## SUMMARY / GO-NO-GO

**EIP-7702 gate: PASS for all 6 chains. No DROP.**

- Ethereum (1): LIVE (Pectra, 2025-05-07)
- Arbitrum One (42161): LIVE (ArbOS 40 Callisto + live Arbiscan authorization data)
- Optimism (10): LIVE (Isthmus, 2025-05-09)
- Base (8453): LIVE (Isthmus, 2025-05-09, same OP Stack hardfork as Optimism)
- BSC (56): LIVE (Pascal / BEP-441, 2025-03-20) — this was "the one to watch" per the
  brief, and it clears the gate with a clean, well-documented activation.
- Arc testnet (5042002): LIVE (Arc's own EVM-differences docs confirm EIP-7702 behaves as
  on Ethereum; native ERC-4337 + EIP-7702 account abstraction advertised)

**Arc USDT: NO.** Arc testnet is USDC-only (plus EURC, USYC). No USDT contract was found
on Arc's official contract-addresses reference page. Founder must confirm this is expected
before Task 3 adds an Arc chain profile with only USDC as a fee token.

**Notes:**

- Ethereum USDT: address `0xdAC17F958D2ee523a2206206994597C13D831ec7`, 6 decimals. Fetched
  2026-07-23 from the Etherscan token page
  ([etherscan.io/token/0xdAC17F958D2ee523a2206206994597C13D831ec7](https://etherscan.io/token/0xdAC17F958D2ee523a2206206994597C13D831ec7)),
  which renders "Tether USD (USDT)" at that address. Etherscan's page is a rendered read, not a
  direct on-chain `decimals()` call, but it matches the canonical contract and the registry value.

**Everything else in this note (all Circle/BscScan/Arbiscan/BaseScan/Optimistic-Etherscan
token addresses and decimals, Arc's USDC address) was independently fetched and verified against the cited authoritative source.**
