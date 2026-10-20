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
  SCROLL_STEP,
  scrollDepthQuery,
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

export function usePageVisits(filters: Filters | null, pages: string[] | null, refreshKey: number): QueryState<number> {
  return useQuery(filters && pages && pages.length ? pageVisitsQuery(filters, pages) : null, mapVisits, refreshKey);
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
export async function loadPageElements(filters: Filters, pages: string[]): Promise<PageElement[]> {
  return mapPageElements(await runQuery(sectionsQuery(filters, pages, "elements")));
}

export function usePageElements(filters: Filters | null, pages: string[] | null, refreshKey: number): QueryState<PageElement[]> {
  return useQuery(filters && pages && pages.length ? sectionsQuery(filters, pages, "elements") : null, mapPageElements, refreshKey);
}

export function useScrollDepth(filters: Filters | null, pages: string[] | null, refreshKey: number): QueryState<ScrollDepth> {
  return useQuery(filters && pages && pages.length ? scrollDepthQuery(filters, pages) : null, mapScrollDepth, refreshKey);
}

function mapPageElements(rows: Row[]): PageElement[] {
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

export interface ScrollDepth {
  /** Pixels per step of the distribution. */
  step: number;
  /** [deepest point seen (start of the step, px), visits] pairs, shallowest first. */
  steps: [number, number][];
  /** Visits counted in the distribution. */
  visits: number;
}

/** How far down the page visits got, for exposure on the live page. */
export async function loadScrollDepth(filters: Filters, pages: string[]): Promise<ScrollDepth> {
  return mapScrollDepth(await runQuery(scrollDepthQuery(filters, pages)));
}

function mapScrollDepth(rows: Row[]): ScrollDepth {
  const steps: [number, number][] = rows
    .map((r): [number, number] => [num(r["depth"]), num(r["visits"])])
    .filter(([d, v]) => d >= 0 && v > 0)
    .sort((a, b) => a[0] - b[0]);
  return { step: SCROLL_STEP, steps, visits: steps.reduce((s, [, v]) => s + v, 0) };
}

export function useSections(
  filters: Filters | null,
  pages: string[] | null,
  groupBy: GroupBy,
  refreshKey: number,
): QueryState<Section[]> {
  const query = filters && pages && pages.length ? sectionsQuery(filters, pages, groupBy) : null;
  return useQuery(query, groupBy === "sections" ? mapSections : mapElements, refreshKey);
}
