// Values the components watch: the view state, the view's visibility, the
// remembered UI state. Small on purpose: a poll every 2 s doesn't need more.

import { useEffect, useState } from "preact/hooks";

export interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  const value = store.get();
  const [, bump] = useState(0);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => bump((n) => n + 1));
    // it may have changed between this render and subscribing
    if (!Object.is(store.get(), value)) bump((n) => n + 1);
    return unsubscribe;
  }, [store]);
  return value;
}
