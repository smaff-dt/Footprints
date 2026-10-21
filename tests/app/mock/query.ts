/** Stand-in for @dynatrace-sdk/client-query: answers each Footprints query with test data from window.__dt. */
declare global {
  interface Window {
    __dt: { rows: (query: string) => unknown[]; queries: string[] };
  }
}
export const queryExecutionClient = {
  async queryExecute(config: { body: { query: string } }) {
    window.__dt.queries.push(config.body.query);
    await new Promise((r) => setTimeout(r, 30));
    return { state: "SUCCEEDED", result: { records: window.__dt.rows(config.body.query) } };
  },
  async queryPoll() {
    throw new Error("not used");
  },
};
