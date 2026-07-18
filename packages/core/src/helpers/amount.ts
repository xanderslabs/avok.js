function withThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a base-unit bigint into a human string using integer math (no float
 * error). Trailing zeros trimmed; when the integer part is non-zero the fraction
 * is padded to at least 2 places, otherwise the trimmed fraction shows as-is.
 */
export function formatAmount(base: bigint, decimals: number): string {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const divisor = 10n ** BigInt(decimals);
  const intPart = abs / divisor;
  const fracPart = abs % divisor;

  let frac = decimals > 0 ? fracPart.toString().padStart(decimals, "0") : "";
  frac = frac.replace(/0+$/, "");
  if (intPart !== 0n && frac.length < 2) frac = frac.padEnd(2, "0");

  const intStr = withThousands(intPart.toString());
  const body = frac.length > 0 ? `${intStr}.${frac}` : intStr;
  return neg ? `-${body}` : body;
}
