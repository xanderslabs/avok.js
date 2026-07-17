/**
 * A ~30-line reactive store. Holds app-level state (nav, account); screens own
 * their own local state. `setState` merges a partial (or an updater's return)
 * and notifies subscribers; `subscribe` returns an unsubscribe.
 */
export interface Store<S> {
  getState(): S;
  setState(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(fn: (s: S) => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const subs = new Set<(s: S) => void>();
  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of subs) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
