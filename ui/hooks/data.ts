/**
 * Data hooks: each turns filter choices into a query and the query's rows
 * into plain objects the UI can render.
 */
import { useEffect, useState } from "react";
import { num, runQuery, Row, str } from "../dql/client";
import {
  applicationsFromEventsQuery,
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

export function useApplications(): QueryState<Application[]> {
  const [state, setState] = useState<QueryState<Application[]>>({ data: null, loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        let apps = (await runQuery(applicationsQuery(), controller.signal))
          .map((r) => ({ id: str(r["id"]), name: str(r["entity.name"]) }))
          .filter((a) => a.id && a.name);
        if (apps.length === 0) {
          apps = (await runQuery(applicationsFromEventsQuery(), controller.signal))
            .map((r) => ({ id: str(r["id"]), name: str(r["id"]) }))
            .filter((a) => a.id);
        }
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
  url: string;
  clicks: number;
  visits: number;
}

function mapPages(rows: Row[]): PageSummary[] {
  return rows
    .map((r) => ({ url: str(r["page_template"]), clicks: num(r["clicks"]), visits: num(r["visits"]) }))
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

export function useSections(
  filters: Filters | null,
  page: string | null,
  groupBy: GroupBy,
  refreshKey: number,
): QueryState<Section[]> {
  const query = filters && page ? sectionsQuery(filters, page, groupBy) : null;
  return useQuery(query, groupBy === "sections" ? mapSections : mapElements, refreshKey);
}
