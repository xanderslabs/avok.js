import { useState } from "react";

/** The three primary screens shown once an account exists (shared-origin is
 * use-only: no subname/device management screens — those live at the
 * operator's own own-origin app). */
export type Screen = "home" | "send" | "account";

/** Tiny screen-state hook backing the app shell's bottom nav. */
export function useNav(initial: Screen = "home"): {
  screen: Screen;
  setScreen: (s: Screen) => void;
} {
  const [screen, setScreen] = useState<Screen>(initial);
  return { screen, setScreen };
}
