import { useCallback, useState } from "react";

/**
 * Like useState, but remembers the value in this browser so the user finds
 * their last application, page and filters when they come back.
 * Storage can be unavailable (private mode, blocked); the app then simply
 * starts from the defaults.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore: persistence is a convenience only
      }
    },
    [key],
  );

  return [value, set];
}
