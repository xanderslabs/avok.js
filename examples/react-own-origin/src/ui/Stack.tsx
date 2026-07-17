import type { ReactNode } from "react";
import { space } from "../theme/tokens.js";

/** The ONLY place a gap exists. Screens never set margins between children. */
export function Stack({
  gap = "md",
  direction = "column",
  align,
  justify,
  children,
}: {
  gap?: keyof typeof space;
  direction?: "row" | "column";
  align?: string;
  justify?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction,
        gap: space[gap],
        alignItems: align,
        justifyContent: justify,
      }}
    >
      {children}
    </div>
  );
}
