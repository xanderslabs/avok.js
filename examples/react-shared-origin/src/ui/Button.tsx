import type { ReactNode } from "react";

export function Button({
  variant = "primary",
  icon,
  children,
  onClick,
  disabled,
}: {
  variant?: "primary" | "ghost" | "danger";
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}
