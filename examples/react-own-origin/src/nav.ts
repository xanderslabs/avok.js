import { useState } from "react";

/** The three primary screens shown once an account exists, plus secondary screens
 * reached via a link from a primary screen (not shown in the bottom nav). */
export type Screen = "home" | "send" | "account" | "device" | "access";

/** Tiny screen-state hook backing the app shell's bottom nav. */
export function useNav(initial: Screen = "home"): {
  screen: Screen;
  setScreen: (s: Screen) => void;
} {
  const [screen, setScreen] = useState<Screen>(initial);
  return { screen, setScreen };
}
