/**
 * Data hooks: each turns filter choices into a query and the query's rows
 * into plain objects the UI can render.
 */
import { useEffect, useState } from "react";
import { num, runQuery, Row, str } from "../dql/client";
import {
  applicationNamesQuery,
  applicationsQuery,
  Filters,
  GroupBy,
  pagesQuery,
  pageVisitsQuery,
  sectionsQuery,
} from "../dql/queries";
import { elementLabel, sectionLabel } from "../lib/labels";
import { QueryState, useQuery } from "./useQuery";

// ── Applications ─────────────────────────────────────────────────────────────

export interface Application {
  id: string;
  name: string;
}

const ENTITY_ID = /^APPLICATION-[A-F0-9]+$/;

export function useApplications(): QueryState<Application[]> {
  const [state, setState] = useState<QueryState<Application[]>>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const ids = (await runQuery(applicationsQuery(), controller.signal)).map((r) => str(r["app"])).filter(Boolean);

        // Older environments identify applications by entity id: look up names.
        let names = new Map<string, string>();
        if (ids.some((id) => ENTITY_ID.test(id))) {
          try {
            const rows = await runQuery(applicationNamesQuery(), controller.signal);
            names = new Map(rows.map((r) => [str(r["id"]), str(r["entity.name"])]));
          } catch {
            // No entity model on this environment: show the ids as they are.
          }
        }

        const apps = ids
          .map((id) => ({ id, name: names.get(id) || id }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!controller.signal.aborted) setState({ data: apps, loading: false, error: null });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => controller.abort();
  }, []);

  return state;
}

// ── Pages ────────────────────────────────────────────────────────────────────

export interface PageSummary {
  /** The page template, e.g. https://site/journeys/*\/book */
  url: string;
  /** One real address of that page, used to open it in the browser. */
  sample: string;
  clicks: number;
  visits: number;
}

function mapPages(rows: Row[]): PageSummary[] {
  return rows
    .map((r) => ({
      url: str(r["page_template"]),
      sample: str(r["sample"]),
      clicks: num(r["clicks"]),
      visits: num(r["visits"]),
    }))
    .filter((p) => p.url);
}

export function usePages(filters: Filters | null, refreshKey: number): QueryState<PageSummary[]> {
  return useQuery(filters ? pagesQuery(filters) : null, mapPages, refreshKey);
}

// ── One page ─────────────────────────────────────────────────────────────────

function mapVisits(rows: Row[]): number {
  return num(rows[0]?.["visits"]);
}

export function usePageVisits(filters: Filters | null, page: string | null, refreshKey: number): QueryState<number> {
  return useQuery(filters && page ? pageVisitsQuery(filters, page) : null, mapVisits, refreshKey);
}

export interface Section {
  key: string;
  label: string;
  clicks: number;
  visits: number;
}

function mapSections(rows: Row[]): Section[] {
  return rows.map((r) => ({
    key: str(r["section"]),
    label: sectionLabel(str(r["section"])),
    clicks: num(r["clicks"]),
    visits: num(r["visits"]),
  }));
}

function mapElements(rows: Row[]): Section[] {
  return rows.map((r) => ({
    key: str(r["section"]),
    label: elementLabel(str(r["name"]), str(r["node"]), str(r["tag"])),
    clicks: num(r["clicks"]),
    visits: num(r["visits"]),
  }));
}

// ── Data for the browser extension ───────────────────────────────────────────

export interface PageElement {
  /** The xpath as recorded by Dynatrace, one segment per item. */
  xpath: string[];
  clicks: number;
  visits: number;
  label: string;
}

/** Every clicked element of a page, for drawing on the live page. */
export async function loadPageElements(filters: Filters, page: string): Promise<PageElement[]> {
  const rows = await runQuery(sectionsQuery(filters, page, "elements"));
  const out: PageElement[] = [];
  for (const r of rows) {
    let xpath: unknown;
    try {
      xpath = JSON.parse(str(r["section"]));
    } catch {
      continue;
    }
    if (!Array.isArray(xpath) || xpath.length === 0) continue;
    out.push({
      xpath: xpath.map(String),
      clicks: num(r["clicks"]),
      visits: num(r["visits"]),
      label: elementLabel(str(r["name"]), str(r["node"]), str(r["tag"])),
    });
  }
  return out;
}

export function useSections(
  filters: Filters | null,
  page: string | null,
  groupBy: GroupBy,
  refreshKey: number,
): QueryState<Section[]> {
  const query = filters && page ? sectionsQuery(filters, page, groupBy) : null;
  return useQuery(query, groupBy === "sections" ? mapSections : mapElements, refreshKey);
}
