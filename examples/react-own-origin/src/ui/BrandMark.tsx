// The node/diamond mark: an ink tile with a rotated rounded-square glyph.
// Size-derived geometry stays inline (it scales with the `size` prop); the ink
// and ink-text colors come from .brand-mark, and the glyph rides on currentColor.
export function BrandMark({ size = 20 }: { size?: number }) {
  const glyph = Math.round(size * 0.55);
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <svg viewBox="0 0 24 24" width={glyph} height={glyph} fill="currentColor" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="2.6" transform="rotate(45 12 12)" />
      </svg>
    </span>
  );
}
