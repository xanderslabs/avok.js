import type { ReactNode } from "react";

/**
 * A tappable settings/action row: icon tile + title/desc + an optional end
 * adornment (badge, ↗ popup tag) and a chevron. `danger` tints the icon+title.
 */
export function ListRow({
  icon,
  title,
  desc,
  end,
  chevron = true,
  danger = false,
  onClick,
}: {
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  end?: ReactNode;
  chevron?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={danger ? "list-row list-danger" : "list-row"}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      {icon && <span className="list-icon">{icon}</span>}
      <div style={{ minWidth: 0 }}>
        <div className="list-title">{title}</div>
        {desc && <div className="list-desc">{desc}</div>}
      </div>
      <div className="list-end">
        {end}
        {chevron && onClick && <span>›</span>}
      </div>
    </div>
  );
}

/** The ↗ popup affordance used by shared-origin verb rows. */
export function PopupTag() {
  return <span className="badge">↗ popup</span>;
}

/** Small pill badge (e.g. "subname set"). */
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge badge-success">{children}</span>;
}
