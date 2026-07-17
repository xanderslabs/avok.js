// Inlined Avok design tokens — the single import site for this app's design
// values. Swap these brand values (palette/radius/space/font/type) to reskin
// the demo. Kept self-contained (no external design-package dependency) so this
// example stays universally cloneable. Values match the 2026-07-04 design spec.

export type Scheme = {
  bg: string;
  bg2: string;
  border: string;
  text: string;
  text2: string;
  text3: string;
  ink: string;
  inkText: string;
  accent: string;
  success: string;
  danger: string;
  onDanger: string;
  caution: string;
};

export const palette: { light: Scheme; dark: Scheme } = {
  light: {
    bg: "#FFFFFF",
    bg2: "#FAFAFA",
    border: "#E4E4E7",
    text: "#18181B",
    text2: "#3F3F46",
    text3: "#71717A",
    ink: "#18181B",
    inkText: "#FFFFFF",
    accent: "#2563EB",
    success: "#15803D",
    danger: "#DC2626",
    onDanger: "#FFFFFF",
    caution: "#B45309",
  },
  dark: {
    bg: "#18181B",
    bg2: "#242427",
    border: "#2E2E33",
    text: "#FAFAFA",
    text2: "#D4D4D8",
    text3: "#A1A1AA",
    ink: "#FAFAFA",
    inkText: "#18181B",
    accent: "#7AA2FF",
    success: "#4ADE80",
    danger: "#F87171",
    onDanger: "#18181B",
    caution: "#FBBF24",
  },
};

// Radius (px). Balanced calibration.
export const radius = { outer: 12, card: 9, button: 8, input: 8 } as const;

// Spacing (px) on an 8px grid.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

// Font stacks. `sans`/`mono` = brand (Geist) for facades + docs.
// `sansSystem`/`monoSystem` = zero-byte native stacks for the CSP popups.
export const font = {
  sans: "'Geist', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sansSystem: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  monoSystem: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

// Type scale.
export const type = {
  display: { size: 24, weight: 600 }, // wallet headline balance; tabular figures
  title: { size: 15, weight: 600, tracking: "-0.01em" },
  body: { size: 14, weight: 400, line: 1.55 },
  amount: { size: 20, weight: 600 },
  value: { size: 13, weight: 400 },
  label: { size: 12, weight: 400 },
  micro: { size: 10, weight: 500 },
} as const;
