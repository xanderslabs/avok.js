import { Text } from "./Text.js";

export function TokenRow({
  symbol,
  name,
  chain,
  amount,
  usd,
  glyph,
  first,
}: {
  symbol: string;
  name: string;
  chain: string;
  amount: string;
  usd?: string;
  glyph?: string;
  first?: boolean;
}) {
  return (
    <div className={first ? "token-row" : "token-row token-row-divided"}>
      <span className="token-glyph">{glyph ?? symbol.slice(0, 1)}</span>
      <div>
        <Text variant="value" as="div">
          {name}
        </Text>
        <Text variant="label" tone="subtle" as="div">
          {chain}
        </Text>
      </div>
      <div className="token-amounts">
        <Text variant="amount" mono as="div">
          {amount}
        </Text>
        {usd && (
          <Text variant="label" tone="subtle" as="div">
            {usd}
          </Text>
        )}
      </div>
    </div>
  );
}
