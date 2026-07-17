import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Mode = "light" | "dark";
type Ctx = { t: Mode; toggle: () => void };
const ThemeCtx = createContext<Ctx | null>(null);

const query = "(prefers-color-scheme: dark)";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Mode>(() =>
    typeof window !== "undefined" && window.matchMedia?.(query).matches ? "dark" : "light",
  );

  // Follow the OS while the user hasn't overridden it. Without this listener the
  // theme is frozen at whatever it was when the tab loaded.
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setT(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // tokens.css keys its dark overrides off this attribute, so the toggle beats the OS.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t);
  }, [t]);

  return (
    <ThemeCtx.Provider value={{ t, toggle: () => setT((p) => (p === "light" ? "dark" : "light")) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}
