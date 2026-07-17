import { useEffect, useState } from "react";
import { useAccount } from "@avokjs/react";
import { selectableChains, chainName } from "@avokjs/helpers";
import { readBalances, readSolanaBalances, type TokenBalance } from "@avokjs/helpers";
import { config, type SolanaCluster } from "../config.js";
import { Card, ChainSwitcher, TokenRow, AddressText, EmptyState, Button, Icon, Text } from "../ui/index.js";

// Home-base display defaults to the ANCHOR chain (where this wallet anchors its access slots).
// Shared-origin apps don't manage custody (no anchor), so the display-default is the first selectable chain.
const DEFAULT_CHAIN = selectableChains[0]?.id ?? 8453;
const CLUSTERS: SolanaCluster[] = ["devnet", "mainnet"];

export function Home({ onSend }: { onSend: () => void }) {
  const { account } = useAccount();
  const [chainId, setChainId] = useState(DEFAULT_CHAIN);
  const [cluster, setCluster] = useState<SolanaCluster>("devnet");
  const [balances, setBalances] = useState<TokenBalance[] | null>(null);
  const [solBalances, setSolBalances] = useState<TokenBalance[] | null>(null);

  const evmAddress = account?.evm.address;
  const solanaAddress = account?.solana.address;

  useEffect(() => {
    if (!evmAddress) return;
    let live = true;
    setBalances(null);
    readBalances(chainId, evmAddress, config.rpcUrls)
      .then((b) => live && setBalances(b))
      .catch(() => live && setBalances([]));
    return () => {
      live = false;
    };
  }, [chainId, evmAddress]);

  useEffect(() => {
    if (!solanaAddress) return;
    let live = true;
    setSolBalances(null);
    readSolanaBalances(cluster, solanaAddress, config.rpcUrls)
      .then((b) => live && setSolBalances(b))
      .catch(() => live && setSolBalances([]));
    return () => {
      live = false;
    };
  }, [solanaAddress, cluster]);

  if (!account) {
    return <EmptyState>Sign in to see your balances.</EmptyState>;
  }

  return (
    <div className="screen-body">
      {/* Identity */}
      <div style={{ marginBottom: 18 }}>
        <Text variant="title" as="div" style={{ marginBottom: 8 }}>
          Your wallet
        </Text>
        <div className="addr-row" style={{ marginBottom: 4 }}>
          <span className="addr-rail">EVM</span>
          <AddressText address={account.evm.address} copy />
        </div>
        <div className="addr-row">
          <span className="addr-rail">Solana</span>
          <AddressText address={account.solana.address} copy />
        </div>
      </div>

      {/* EVM balances */}
      <Card>
        <div style={{ marginBottom: 12 }}>
          <ChainSwitcher
            chains={selectableChains.map((c) => ({ id: c.id, name: c.name }))}
            selected={chainId}
            onSelect={setChainId}
          />
        </div>
        {balances === null ? (
          <EmptyState loading>Loading balances…</EmptyState>
        ) : balances.length === 0 ? (
          <EmptyState>Could not load balances for {chainName(chainId)}.</EmptyState>
        ) : (
          <>
            {balances.map((b, i) => (
              <TokenRow
                key={b.address ?? "native"}
                symbol={b.symbol}
                name={b.symbol}
                chain={chainName(chainId)}
                amount={b.formatted}
                glyph={b.address === null ? "◆" : b.symbol.slice(0, 1)}
                first={i === 0}
              />
            ))}
          </>
        )}
      </Card>

      {/* Solana — pick the cluster (devnet / mainnet); the SDK targets it per call. */}
      <Card>
        <div className="section-label">Solana</div>
        <div className="segmented" style={{ marginBottom: 12 }}>
          {CLUSTERS.map((c) => (
            <button
              key={c}
              className={cluster === c ? "segmented-btn segmented-active" : "segmented-btn"}
              onClick={() => setCluster(c)}
            >
              {c === "mainnet" ? "Mainnet" : "Devnet"}
            </button>
          ))}
        </div>
        {solBalances === null ? (
          <EmptyState loading>Loading Solana balances…</EmptyState>
        ) : solBalances.length === 0 ? (
          <EmptyState>Could not load Solana balances.</EmptyState>
        ) : (
          solBalances.map((b, i) => (
            <TokenRow
              key={b.symbol}
              symbol={b.symbol}
              name={b.symbol}
              chain={`Solana ${cluster}`}
              amount={b.formatted}
              glyph={b.symbol === "SOL" ? "◎" : b.symbol.slice(0, 1)}
              first={i === 0}
            />
          ))
        )}
      </Card>

      <Button variant="primary" icon={<Icon name="send" size={15} />} onClick={onSend}>
        Send
      </Button>
    </div>
  );
}
