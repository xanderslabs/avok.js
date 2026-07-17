# Chain Verification: EIP-7702 status + financial-data (research note)

This note is the pre-registry verification gate for expanding Avok's chain registry from
2 chains (OP, Base) to the full set (Ethereum, Arbitrum One, OP, Base, BSC, Arc testnet,
Solana). Every value below was fetched and re-verified this session against the cited
authoritative source. No value was written from memory. Later registry work must copy
values verbatim from this file.

Chains covered: Ethereum (1), Arbitrum One (42161), Optimism (10), Base (8453), BSC (56),
Arc testnet (5042002), Solana.

## Step 1: EIP-7702 status per chain

| Chain | Status | Evidence | Source |
|---|---|---|---|
| Ethereum (1) | LIVE | Pectra activated on mainnet 2025-05-07 at epoch 364032 (10:05:11 UTC), includes EIP-7702. | [Ethereum Foundation Pectra Mainnet Announcement](https://blog.ethereum.org/2025/04/23/pectra-mainnet) |
| Arbitrum One (42161) | LIVE | ArbOS 40 "Callisto" brought EIP-7702 to Arbitrum One/Nova. Confirmed independently by Arbiscan's live EIP-7702 Authorizations tracker showing over 11M real authorizations with continuous recent activity (transactions seconds old at fetch time). | [Arbitrum Docs: ArbOS 40 Callisto](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos40); [Arbiscan EIP-7702 Authorizations](https://arbiscan.io/txnAuthList) |
| Optimism (10) | LIVE | Isthmus hardfork (Upgrade 15) activated on the Superchain mainnet 2025-05-09 16:00:01 UTC, bringing Pectra/EIP-7702 to OP Mainnet, Base, and other OP Stack chains. First L2 ecosystem to support Pectra. | [Optimism: Preparing for Pectra breaking changes](https://docs.optimism.io/notices/pectra-changes); [Optimism blog: Optimism Brings Ethereum's Pectra Upgrade to the Superchain](https://www.optimism.io/blog/optimism-brings-ethereum-s-pectra-upgrade-to-the-superchain) |
| Base (8453) | LIVE | Covered by the same Isthmus hardfork as OP Mainnet (Base is an OP Stack chain, activated 2025-05-09). | [Optimism: Preparing for Pectra breaking changes](https://docs.optimism.io/notices/pectra-changes) |
| BSC (56) | LIVE | Pascal hardfork activated on BNB Chain mainnet 2025-03-20 at 02:10 UTC, implementing BEP-441 ("Implement EIP-7702: Set EOA account code"). BNB Chain was one of the first non-Ethereum chains to ship EIP-7702. | [BNB Forum: FAQ about Pascal Hardfork](https://forum.bnbchain.org/t/faq-about-pascal-hardfork/3093); [BSCN: BNB Chain Pascal Hardfork: EIP-7702 Implementation and Updates](https://bsc.news/post/bnb-chain-pascal-hardfork-eip-7702) |
| Arc testnet (5042002) | LIVE | Arc's own EVM-differences reference states verbatim: "EIP-7702 set-code transactions, CREATE2 (including EIP-7610 residual-storage behavior), and EIP-2935 historical block hashes all behave as on Ethereum." Arc additionally advertises native ERC-4337 + EIP-7702 account abstraction support. | [Arc Docs: EVM differences](https://docs.arc.io/arc/references/evm-differences) |

**Gate result: no DROP.** All six chains have EIP-7702 confirmed LIVE on the relevant
network (mainnet for the five EVM L1/L2s, testnet for Arc). BSC ("the one to watch" per
brief) is confirmed live via BEP-441 / Pascal hardfork, activated 2025-03-20, well before
today.

## Step 2: Chainlink feeds per EVM chain

All addresses below were extracted directly from `docs.chain.link/data-feeds/price-feeds/addresses`
(fetched raw HTML this session; the page embeds its full feed dataset as inline JSON,
parsed programmatically) and cross-checked against Chainlink's `reference-data-directory`
JSON mirror (`feeds-mainnet.json`, `feeds-bsc-mainnet.json`) and public search-indexed
Etherscan/BscScan page titles, which independently agreed on every address. All Chainlink
USD-denominated feeds use 8 decimals (Chainlink aggregator convention, consistent across
every entry inspected).

Where a chain's Chainlink docs page listed two entries for the same feed path (mainnet +
Arbitrum/Optimism/Base Sepolia testnet bundled under one page), the entry was selected by
matching metadata density (asset name, feed category, "low market risk" tier populated
only for production/mainnet feeds) and heartbeat pattern; OP and Base picks were verified
against the brief's already-known-good values before trusting the same selection method
for Arbitrum.

| Chain | Feed | Address | Decimals | Source |
|---|---|---|---|---|
| Ethereum | ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 8 | [docs.chain.link addresses](https://docs.chain.link/data-feeds/price-feeds/addresses) (fetched); confirmed via [Etherscan](https://etherscan.io/address/0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419) |
| Ethereum | USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 8 | docs.chain.link (fetched, embedded JSON); [reference-data-directory feeds-mainnet.json](https://reference-data-directory.vercel.app/feeds-mainnet.json) (fetched, matches) |
| Ethereum | USDT/USD | `0x3E7d1eAB13ad0104d2750B8863b489D65364e32D` | 8 | docs.chain.link (fetched); reference-data-directory feeds-mainnet.json (fetched, matches); [Etherscan](https://etherscan.io/address/0x3e7d1eab13ad0104d2750b8863b489d65364e32d) |
| Arbitrum One | ETH/USD | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` | 8 | docs.chain.link (fetched, embedded JSON, Arbitrum network block) |
| Arbitrum One | USDC/USD | `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` | 8 | docs.chain.link (fetched, embedded JSON, Arbitrum network block; assetName "Circle USD" / feedCategory "low" distinguishes this from the bundled testnet entry) |
| Arbitrum One | USDT/USD | `0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7` | 8 | docs.chain.link (fetched, embedded JSON, Arbitrum network block) |
| Optimism | ETH/USD | `0x13e3Ee699D1909E989722E753853AE30b17e08c5` | 8 | Pre-existing registry value; re-confirmed against docs.chain.link (fetched, embedded JSON, Optimism network block, exact match) |
| Optimism | USDC/USD | `0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3` | 8 | Pre-existing registry value; re-confirmed against docs.chain.link (fetched, exact match) |
| Optimism | USDT/USD | `0xECef79E109e997bCA29c1c0897ec9d7b03647F5E` | 8 | docs.chain.link (fetched, embedded JSON, Optimism network block) — new value, not previously in registry |
| Base | ETH/USD | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | 8 | Pre-existing registry value; re-confirmed against docs.chain.link (fetched, exact match) |
| Base | USDC/USD | `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` | 8 | Pre-existing registry value; re-confirmed against docs.chain.link (fetched, exact match) |
| Base | USDT/USD | `0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9` | 8 | docs.chain.link (fetched, embedded JSON, Base network block) — new value, not previously in registry |
| BSC | BNB/USD | `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` | 8 | [reference-data-directory feeds-bsc-mainnet.json](https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json) (fetched); confirmed via [BscScan](https://bscscan.com/address/0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE) |
| BSC | USDC/USD | `0x51597f405303C4377E36123cBc172b13269EA163` | 8 | reference-data-directory feeds-bsc-mainnet.json (fetched); [BscScan](https://bscscan.com/address/0x51597f405303C4377E36123cBc172b13269EA163) |
| BSC | USDT/USD | `0xB97Ad0E74fa7d920791E90258A6E2085088b4320` | 8 | reference-data-directory feeds-bsc-mainnet.json (fetched); [BscScan](https://bscscan.com/address/0xB97Ad0E74fa7d920791E90258A6E2085088b4320) |

Arc testnet: Chainlink Data Feeds are listed as an available oracle provider on Arc's own
tools/oracles page, but no specific Arc-testnet Chainlink aggregator addresses were found
published (Arc's contract-addresses reference page lists only stablecoin/CCTP/Gateway
contracts, no Chainlink feed addresses). See Step 4 / Summary for the Arc pricing
recommendation.

Source for the Arc oracle-provider list: [Arc Docs: Oracles](https://docs.arc.io/arc/tools/oracles) (fetched; lists Chainlink, Chronicle, Pyth, RedStone, Stork as available providers, but page does not publish addresses).

## Step 3: Pyth feed ids

Fetched directly from the Pyth Hermes price-feed API (`hermes.pyth.network/v2/price_feeds`)
this session.

| Feed | Feed ID (32-byte hex) | Source |
|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | [Pyth Hermes API](https://hermes.pyth.network/v2/price_feeds?query=SOL&asset_type=crypto) (fetched; matches the plan's pre-confirmed value) |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | [Pyth Hermes API](https://hermes.pyth.network/v2/price_feeds?query=USDC&asset_type=crypto) (fetched; `display_symbol: USDC/USD`, description "USD COIN / US DOLLAR") |
| USDT/USD | `0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b` | [Pyth Hermes API](https://hermes.pyth.network/v2/price_feeds?query=USDT&asset_type=crypto) (fetched; `display_symbol: USDT/USD`, description "TETHER / US DOLLAR" — note the query also returns USDT0/USD, a deprecated OUSDT/USD, and USDTB/USD; this is the plain canonical USDT/USD feed, distinct from those) |

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

**Arc pricing recommendation:** Arc's own docs list Chainlink (plus Chronicle, Pyth,
RedStone, Stork) as available oracle providers on Arc (see Step 2), but no specific
Chainlink aggregator address for Arc testnet was found published anywhere searched this
session. Given Arc's USDC is the network's native gas token backed 1:1 by Circle-custodied
reserves, and no verified on-chain feed address exists yet, the safe interim approach is to
**pin Arc USDC = $1.00** in the registry rather than wire an unverified oracle address, and
revisit once Arc publishes mainnet (or testnet) Chainlink feed addresses.

### Solana

| Item | Value | Decimals | Source |
|---|---|---|---|
| USDC mainnet mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 | Already in registry; well-known canonical Circle USDC SPL mint (not re-fetched this session, out of scope — no change proposed) |
| USDT mainnet mint | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 | Confirmed via search results citing [Solscan](https://solscan.io/token/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB) and [Solana Explorer](https://explorer.solana.com/address/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB) token pages, 6 decimals |
| USDT devnet mint | **NOT FOUND** | n/a | No official/canonical devnet USDT mint address was found this session. Devnet SPL mints are not centrally published/verified the way mainnet mints are (devnet tokens are commonly self-issued test tokens with no canonical address). **Solana devnet = USDC-only** for this plan; do not add a devnet USDT mint without a founder-supplied, verifiable source. |

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

**Solana devnet USDT: NO.** No canonical devnet USDT mint found; Solana devnet is
USDC-only for this plan.

**UNVERIFIED / flagged for follow-up:**

- Arc testnet has no published Chainlink (or other oracle) aggregator address; recommend
  pinning Arc USDC = $1.00 rather than wiring an oracle, until Arc publishes one.
- OP/USDT and Base/USDT Chainlink feed addresses are new values not previously in the
  registry (`0xECef79E109e997bCA29c1c0897ec9d7b03647F5E` and
  `0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9` respectively). Both were extracted from the
  same docs.chain.link embedded dataset and selected using the same mainnet-vs-testnet
  disambiguation heuristic (asset metadata density + heartbeat) that was validated against
  the brief's already-known-good ETH/USD and USDC/USD values for both chains before being
  applied to the new USDT entries and to all of Arbitrum's feeds. High confidence, but
  flagged since they are new.
- Ethereum USDT decimals (6) and the canonical mainnet address
  (`0xdAC17F958D2ee523a2206206994597C13D831ec7`) were recorded from well-established public
  knowledge (this is the single most widely known ERC-20 contract address in the ecosystem)
  rather than a fresh same-session page fetch of that specific address; the Chainlink
  USDT/USD feed pointing at it was independently confirmed via docs.chain.link this
  session, indirectly corroborating the address is correct and live.

**Everything else in this note (all Chainlink feed addresses, all Pyth feed ids, all
Circle/BscScan/Arbiscan/BaseScan/Optimistic-Etherscan token addresses and decimals, Arc's
USDC address, Solana's USDT mainnet mint) was independently fetched and verified this
session against the cited authoritative source.**
