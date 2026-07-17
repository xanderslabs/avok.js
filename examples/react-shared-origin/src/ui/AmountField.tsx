import { Text } from "./Text.js";

export function AmountField({
  value,
  token,
  onChange,
  onMax,
  balanceLabel,
}: {
  value: string;
  token: string;
  onChange: (v: string) => void;
  onMax?: () => void;
  balanceLabel?: string;
}) {
  return (
    <div className="field">
      <label className="field-label">Amount</label>
      <div className="amount-box">
        <input
          className="amount-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
        />
        <span className="amount-token">{token}</span>
      </div>
      {(balanceLabel || onMax) && (
        <div className="field-foot">
          <Text variant="label" tone="subtle">
            {balanceLabel}
          </Text>
          {onMax && (
            <button className="addr-copy" onClick={onMax}>
              Max
            </button>
          )}
        </div>
      )}
    </div>
  );
}
