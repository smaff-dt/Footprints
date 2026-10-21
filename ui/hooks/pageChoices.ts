/**
 * Pages and page groups of an application, for the page and goal pickers.
 * The page list is a heavy query: it runs only once a picker is opened.
 */
import { useMemo } from "react";
import type { Filters } from "../dql/queries";
import { choicesFor, looseChoice, PageChoice, PageGroup } from "../lib/pages";
import { pageHost } from "../lib/labels";
import { PageSummary, usePages } from "./data";
import type { QueryState } from "./useQuery";

export function usePageChoices(
  appId: string | null,
  groups: PageGroup[],
  wanted: boolean,
  refreshKey: number,
): { filters: Filters | null; pages: QueryState<PageSummary[]>; choices: PageChoice[] } {
  const filters = useMemo<Filters | null>(() => (appId ? { appId, timeframe: "7d", device: "all" } : null), [appId]);
  const pages = usePages(wanted ? filters : null, refreshKey);
  const choices = useMemo(() => choicesFor(pages.data ?? [], groups, appId ?? ""), [pages.data, groups, appId]);
  return { filters, pages, choices };
}

/** The choice for a saved key: a group, a listed page, or a page address seen on `host`. */
export function choiceForKey(key: string, choices: PageChoice[], host: string | null): PageChoice | null {
  const listed = choices.find((ch) => ch.key === key);
  if (listed) return listed;
  const loose = looseChoice(key);
  return loose && (!host || pageHost(key) === host) ? loose : null;
}
