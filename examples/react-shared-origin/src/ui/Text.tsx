import type { CSSProperties, ElementType, ReactNode } from "react";
import { type } from "../theme/tokens.js";

type Variant = keyof typeof type;
type Tone = "default" | "muted" | "subtle" | "success" | "danger" | "caution";

const tones: Record<Tone, string> = {
  default: "var(--text)",
  muted: "var(--text2)",
  subtle: "var(--text3)",
  success: "var(--success)",
  danger: "var(--danger)",
  caution: "var(--caution)",
};

/**
 * The ONLY place a font-size exists in this app. Screens never set one: if a screen
 * needs a size the scale lacks, the scale is wrong — fix tokens.ts, not the screen.
 * (Before this existed the screens hardcoded fontSize 31 times at 11px and 29 at 12px,
 * while the token scale said body was 14px. Nobody chose 11px; it was drift.)
 */
export function Text({
  variant = "body",
  tone = "default",
  as: As = "span",
  mono = false,
  style,
  children,
}: {
  variant?: Variant;
  tone?: Tone;
  as?: ElementType;
  mono?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const t = type[variant];
  return (
    <As
      style={{
        fontSize: t.size,
        fontWeight: t.weight,
        lineHeight: "line" in t ? t.line : undefined,
        letterSpacing: "tracking" in t ? t.tracking : undefined,
        fontFamily: mono ? "var(--font-mono)" : undefined,
        fontVariantNumeric: variant === "display" || variant === "amount" ? "tabular-nums" : undefined,
        color: tones[tone],
        ...style,
      }}
    >
      {children}
    </As>
  );
}
