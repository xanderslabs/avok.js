import type { ReactNode } from "react";

// A sub-screen body. Renders an optional in-body header (back ‹ + title) and
// the padded content area.
export function Screen({ title, onBack, children }: { title?: string; onBack?: () => void; children: ReactNode }) {
  return (
    <div>
      {(title || onBack) && (
        <div className="screen-header">
          {onBack && (
            <button className="screen-back" onClick={onBack} aria-label="Back">
              ‹
            </button>
          )}
          {title && <span className="screen-title">{title}</span>}
        </div>
      )}
      <div className="screen-body">{children}</div>
    </div>
  );
}
