import { palette, radius, space, font, type Scheme } from "./tokens.js";

// Maps Scheme keys → CSS custom-property names (kebab-case).
const COLOR_VARS: Record<keyof Scheme, string> = {
  bg: "--color-bg",
  bg2: "--color-bg-2",
  border: "--color-border",
  text: "--color-text",
  text2: "--color-text-2",
  text3: "--color-text-3",
  ink: "--color-ink",
  inkText: "--color-ink-text",
  accent: "--color-accent",
  success: "--color-success",
  danger: "--color-danger",
  onDanger: "--color-on-danger",
  caution: "--color-caution",
};

function colorDecls(scheme: Scheme): string {
  return (Object.keys(COLOR_VARS) as (keyof Scheme)[])
    .map((k) => `    ${COLOR_VARS[k]}: ${scheme[k]};`)
    .join("\n");
}

// Non-color vars are mode-independent; emitted once in the light :root.
function staticDecls(): string {
  return [
    `    --radius-outer: ${radius.outer}px;`,
    `    --radius-card: ${radius.card}px;`,
    `    --radius-button: ${radius.button}px;`,
    `    --radius-input: ${radius.input}px;`,
    `    --space-xs: ${space.xs}px;`,
    `    --space-sm: ${space.sm}px;`,
    `    --space-md: ${space.md}px;`,
    `    --space-lg: ${space.lg}px;`,
    `    --space-xl: ${space.xl}px;`,
    `    --font-sans: ${font.sansSystem};`,
    `    --font-mono: ${font.monoSystem};`,
  ].join("\n");
}

/**
 * Returns the token CSS string popup renderers inline into their <style>.
 * Light values in :root; dark values under prefers-color-scheme:dark.
 * System font stacks only (popups are CSP-locked — no webfont).
 */
export function tokensCss(): string {
  return `:root {
${colorDecls(palette.light)}
${staticDecls()}
  }
  @media (prefers-color-scheme: dark) {
    :root {
${colorDecls(palette.dark)}
    }
  }`;
}

/**
 * Shared popup primitive CSS. Authored once against the token custom properties
 * so the five popup renderers don't re-author chrome. No hardcoded hex, no
 * external load. Fonts come from --font-sans / --font-mono (system stacks).
 */
export function primitivesCss(): string {
  return `
  .avok-body {
    margin: 0;
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    display: flex;
    justify-content: center;
    padding: var(--space-lg);
  }
  .avok-pop {
    width: 100%;
    max-width: 420px;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-outer);
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06);
  }
  .avok-pop-h {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--color-border);
  }
  .avok-ic { color: var(--color-text); width: 16px; height: 16px; flex: none; }
  .avok-wm { font-weight: 700; letter-spacing: -0.02em; font-size: 14px; color: var(--color-text); }
  .avok-ctx { margin-left: auto; font-size: 11px; color: var(--color-text-3); word-break: break-all; text-align: right; }
  .avok-pop-b { padding: var(--space-lg); }
  .avok-ttl { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-text); margin: 0 0 var(--space-md); }
  .avok-body-text { font-size: 14px; line-height: 1.55; color: var(--color-text-2); margin: 0 0 var(--space-md); }
  .avok-card {
    background: var(--color-bg-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin-bottom: var(--space-md);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    color: var(--color-text);
  }
  .avok-kv { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-md); }
  .avok-k { font-size: 12px; color: var(--color-text-3); }
  .avok-v { font-size: 13px; color: var(--color-text); font-weight: 500; }
  .avok-v--mono { font-family: var(--font-mono); font-weight: 400; }
  .avok-amt { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-text); font-family: var(--font-mono); }
  .avok-divider { height: 1px; background: var(--color-border); }
  .avok-acts { display: flex; gap: 9px; }
  .avok-btn {
    flex: 1;
    padding: 10px 14px;
    border-radius: var(--radius-button);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    border: 1px solid transparent;
    cursor: pointer;
    text-align: center;
  }
  .avok-btn:disabled { opacity: .55; cursor: default; }
  .avok-btn--primary { background: var(--color-ink); color: var(--color-ink-text); }
  .avok-btn--secondary { background: transparent; color: var(--color-text-2); border-color: var(--color-border); }
  .avok-btn--danger { background: var(--color-danger); color: var(--color-on-danger); }
  .avok-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 13px;
    margin-bottom: var(--space-md);
  }
  .avok-link { color: var(--color-accent); text-decoration: none; font-size: 12px; }
  .avok-warning {
    background: color-mix(in srgb, var(--color-caution) 12%, transparent);
    border: 1px solid var(--color-caution);
    border-radius: var(--radius-card);
    padding: var(--space-md);
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-text);
    margin-bottom: var(--space-md);
  }
  .avok-status { margin-top: var(--space-md); font-size: 13px; color: var(--color-text-3); }
  .avok-btn:focus-visible, .avok-input:focus-visible, .avok-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }`;
}
