/**
 * Data hooks: each turns filter choices into a query and the query's rows
 * into plain objects the UI can render.
 */
import { useEffect, useState } from "react";
import { num, runQuery, Row, str } from "../dql/client";
import {
  applicationNamesQuery,
  applicationsQuery,
  clickPositionsQuery,
  clickWidthsQuery,
  elementConversionQuery,
  pageConversionQuery,
  Filters,
  GroupBy,
  pagesQuery,
  PageScope,
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
  /** The page's address without query string, e.g. https://site/product/2ZYFJ3GM2N */
  url: string;
  clicks: number;
  visits: number;
}

function mapPages(rows: Row[]): PageSummary[] {
  return rows
    .map((r) => ({ url: str(r["fp_page"]), clicks: num(r["clicks"]), visits: num(r["visits"]) }))
    .filter((p) => p.url);
}

/** The most visited pages with clicks (up to PAGE_LIMIT). */
export function usePages(filters: Filters | null, refreshKey: number): QueryState<PageSummary[]> {
  return useQuery(filters ? pagesQuery(filters) : null, mapPages, refreshKey);
}

/** Pages whose address contains `text`, asked to Dynatrace (for lists longer than PAGE_LIMIT). */
export async function searchPages(filters: Filters, text: string, signal?: AbortSignal): Promise<PageSummary[]> {
  return mapPages(await runQuery(pagesQuery(filters, { search: text, limit: 200 }), signal));
}

/** The pages a group covers, most visited first. */
export function useScopePages(filters: Filters | null, scope: PageScope | null, refreshKey: number): QueryState<PageSummary[]> {
  return useQuery(filters && scope ? pagesQuery(filters, { scope }) : null, mapPages, refreshKey);
}

// ── One page ─────────────────────────────────────────────────────────────────

function mapVisits(rows: Row[]): number {
  return num(rows[0]?.["visits"]);
}

export function usePageVisits(filters: Filters | null, scope: PageScope | null, refreshKey: number): QueryState<number> {
  return useQuery(filters && scope ? pageVisitsQuery(filters, scope) : null, mapVisits, refreshKey);
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
export async function loadPageElements(filters: Filters, scope: PageScope): Promise<PageElement[]> {
  return mapPageElements(await runQuery(sectionsQuery(filters, scope, "elements")));
}

export function usePageElements(filters: Filters | null, scope: PageScope | null, refreshKey: number): QueryState<PageElement[]> {
  return useQuery(filters && scope ? sectionsQuery(filters, scope, "elements") : null, mapPageElements, refreshKey);
}

export function useScrollDepth(filters: Filters | null, scope: PageScope | null, refreshKey: number): QueryState<ScrollDepth> {
  return useQuery(filters && scope ? scrollDepthQuery(filters, scope) : null, mapScrollDepth, refreshKey);
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
export async function loadScrollDepth(filters: Filters, scope: PageScope): Promise<ScrollDepth> {
  return mapScrollDepth(await runQuery(scrollDepthQuery(filters, scope)));
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
  scope: PageScope | null,
  groupBy: GroupBy,
  refreshKey: number,
): QueryState<Section[]> {
  const query = filters && scope ? sectionsQuery(filters, scope, groupBy) : null;
  return useQuery(query, groupBy === "sections" ? mapSections : mapElements, refreshKey);
}

// ── Click heatmap ────────────────────────────────────────────────────────────

export interface WidthCount {
  width: number;
  clicks: number;
}

function mapWidths(rows: Row[]): WidthCount[] {
  return rows.map((r) => ({ width: num(r["width"]), clicks: num(r["clicks"]) })).filter((w) => w.width > 0);
}

export function useClickWidths(filters: Filters | null, scope: PageScope | null, refreshKey: number): QueryState<WidthCount[]> {
  return useQuery(filters && scope ? clickWidthsQuery(filters, scope) : null, mapWidths, refreshKey);
}

export interface HeatCell {
  x: number;
  y: number;
  clicks: number;
}

/** Clicks on one element, at one window width, in one cell of the page. */
export interface ClickPosition {
  xpath: string[];
  width: number;
  x: number;
  y: number;
  clicks: number;
}

function mapPositions(rows: Row[]): ClickPosition[] {
  const out: ClickPosition[] = [];
  const parsed = new Map<string, string[] | null>();
  for (const r of rows) {
    const key = str(r["section"]);
    if (!parsed.has(key)) {
      try {
        const v = JSON.parse(key);
        parsed.set(key, Array.isArray(v) && v.length ? v.map(String) : null);
      } catch {
        parsed.set(key, null);
      }
    }
    const xpath = parsed.get(key);
    if (!xpath) continue;
    out.push({ xpath, width: num(r["width"]), x: num(r["x"]), y: num(r["y"]), clicks: num(r["clicks"]) });
  }
  return out;
}

export function useClickPositions(filters: Filters | null, scope: PageScope | null, refreshKey: number): QueryState<ClickPosition[]> {
  return useQuery(filters && scope ? clickPositionsQuery(filters, scope) : null, mapPositions, refreshKey);
}

/** Window widths covering most clicks, for measuring the page at them (most used first). */
export async function loadClickWidths(filters: Filters, scope: PageScope): Promise<WidthCount[]> {
  return mapWidths(await runQuery(clickWidthsQuery(filters, scope)));
}

// ── Conversions ──────────────────────────────────────────────────────────────

export interface Conversion {
  visits: number;
  converted: number;
}

export interface ElementConversion extends Conversion {
  xpath: string[];
}

function mapPageConversion(rows: Row[]): Conversion {
  return { visits: num(rows[0]?.["visits"]), converted: num(rows[0]?.["converted"]) };
}

function mapElementConversions(rows: Row[]): ElementConversion[] {
  const out: ElementConversion[] = [];
  for (const r of rows) {
    let xpath: unknown;
    try {
      xpath = JSON.parse(str(r["section"]));
    } catch {
      continue;
    }
    if (!Array.isArray(xpath) || xpath.length === 0) continue;
    out.push({ xpath: xpath.map(String), visits: num(r["visits"]), converted: num(r["converted"]) });
  }
  return out;
}

export function usePageConversion(filters: Filters | null, scope: PageScope | null, goal: PageScope | null, refreshKey: number): QueryState<Conversion> {
  return useQuery(filters && scope && goal ? pageConversionQuery(filters, scope, goal) : null, mapPageConversion, refreshKey);
}

export function useElementConversions(
  filters: Filters | null,
  scope: PageScope | null,
  goal: PageScope | null,
  refreshKey: number,
): QueryState<ElementConversion[]> {
  return useQuery(filters && scope && goal ? elementConversionQuery(filters, scope, goal) : null, mapElementConversions, refreshKey);
}

/** Visits to a page or group (for the live page drawn by the extension). */
export async function loadPageVisits(filters: Filters, scope: PageScope): Promise<number> {
  return mapVisits(await runQuery(pageVisitsQuery(filters, scope)));
}
