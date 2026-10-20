/**
 * Runs a DQL query against Grail and returns its records.
 *
 * Long-running queries are polled until they finish. The query text is built
 * by `queries.ts`; nothing in the UI ever shows DQL to the user.
 */
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

export type Row = Record<string, unknown>;

const MAX_POLLS = 30;

/** Runs a query and returns its records. */
export async function runQuery(query: string, signal?: AbortSignal): Promise<Row[]> {
  return runQueryOnce(query, signal);
}

async function runQueryOnce(query: string, signal?: AbortSignal): Promise<Row[]> {
  const start = await queryExecutionClient.queryExecute({
    body: {
      query,
      requestTimeoutMilliseconds: 30_000,
      fetchTimeoutSeconds: 120,
      maxResultRecords: 5_000,
    },
    abortSignal: signal,
  });

  if (start.state === "SUCCEEDED") {
    return clean(start.result?.records);
  }
  if (start.state !== "RUNNING" && start.state !== "NOT_STARTED") {
    throw new Error(`The query ${start.state.toLowerCase().replace("_", " ")}`);
  }
  if (!start.requestToken) {
    throw new Error("The query did not return a request token");
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const poll = await queryExecutionClient.queryPoll({
      requestToken: start.requestToken,
      requestTimeoutMilliseconds: 10_000,
      abortSignal: signal,
    });
    if (poll.state === "SUCCEEDED") return clean(poll.result?.records);
    if (poll.state === "FAILED" || poll.state === "CANCELLED" || poll.state === "RESULT_GONE") {
      throw new Error(`The query ${poll.state.toLowerCase().replace("_", " ")}`);
    }
  }
  throw new Error("The query took too long. Try a shorter period.");
}

function clean(records: (Row | null)[] | undefined): Row[] {
  return (records ?? []).filter((r): r is Row => r !== null);
}

/** Grail returns longs as strings; this reads any numeric field safely. */
export function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
