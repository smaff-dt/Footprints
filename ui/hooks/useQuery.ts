import { useEffect, useState } from "react";
import { runQuery, Row } from "../dql/client";

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Runs `query` whenever it changes (pass `null` to skip) and maps the rows
 * with `map`. Older requests are cancelled when the filters change.
 */
export function useQuery<T>(query: string | null, map: (rows: Row[]) => T, refreshKey = 0): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: query !== null, error: null });

  useEffect(() => {
    if (query === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ data: s.data, loading: true, error: null }));
    runQuery(query, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setState({ data: map(rows), loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ data: null, loading: false, error: message });
      });
    return () => controller.abort();
    // `map` is expected to be a stable module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, refreshKey]);

  return state;
}
