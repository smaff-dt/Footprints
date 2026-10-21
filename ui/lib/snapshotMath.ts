/**
 * Numbers on a snapshot: recorded clicks are matched to the snapshot's map,
 * then summed per area for the chosen detail level. Exposure comes from the
 * scroll-depth distribution, using each area's position on the snapshot.
 */
import type { PageElement, ScrollDepth } from "../hooks/data";
import type { Box, Layout, MapArea, SnapshotMap } from "./snapshots";

// ── Matching recorded xpaths to the map ──────────────────────────────────────

const HEADING = /^h[1-6]$/i;

/** Possible canonical spellings of one recorded xpath segment. */
function segmentVariants(raw: string): string[] {
  const seg = raw.trim().replace(/\\"/g, '"');
  let m: RegExpExecArray | null;
  if ((m = /^([a-zA-Z][\w-]*?)\[@id="(.+?)"\]$/.exec(seg))) return [`${m[1].toLowerCase()}[@id="${m[2]}"]`];
  if ((m = /^([a-zA-Z][\w-]*?)@id="(.+?)"$/.exec(seg))) return [`${m[1].toLowerCase()}[@id="${m[2]}"]`];
  if ((m = /^([a-zA-Z][\w-]*)\[(\d+)\]$/.exec(seg))) return [`${m[1].toLowerCase()}[${m[2]}]`];
  if (!HEADING.test(seg) && (m = /^([a-zA-Z](?:[\w-]*?[a-zA-Z-])?)(\d+)$/.exec(seg))) {
    // `div2` is the second div — but `app-offer2` may be a tag name.
    return [`${m[1].toLowerCase()}[${m[2]}]`, `${seg.toLowerCase()}[1]`];
  }
  if ((m = /^([a-zA-Z][\w-]*)$/.exec(seg))) return [`${m[1].toLowerCase()}[1]`];
  return [];
}

/** Every key a recorded xpath could have in a snapshot map. */
export function keysForXpath(xpath: string[]): string[] {
  const keys = [JSON.stringify(xpath)];
  if (xpath.length === 0) return keys;
  let prefix = "";
  let rest = xpath;
  const anchor = /^\/\/\*\[@id=\\?"(.+?)\\?"\]$/.exec(xpath[0]);
  if (anchor) {
    prefix = `#${anchor[1]}`;
    rest = xpath.slice(1);
  }
  let combos: string[][] = [[]];
  for (const seg of rest) {
    const variants = segmentVariants(seg);
    if (variants.length === 0) return keys;
    const next: string[][] = [];
    for (const c of combos) for (const v of variants) next.push([...c, v]);
    combos = next.slice(0, 16);
  }
  for (const c of combos) {
    if (prefix) keys.push(c.length ? `${prefix}/${c.join("/")}` : prefix);
    else keys.push(c.join("/"));
  }
  return keys;
}

export interface MatchedElement {
  index: number; // position in map.elements
  clicks: number;
  visits: number;
}

export interface Matching {
  byElement: Map<number, MatchedElement>;
  matchedClicks: number;
  totalClicks: number;
}

export function matchClicks(map: SnapshotMap, rows: PageElement[]): Matching {
  const index = new Map<string, number>();
  map.elements.forEach((e, i) => {
    for (const k of e.keys) if (!index.has(k)) index.set(k, i);
  });
  const byElement = new Map<number, MatchedElement>();
  let matchedClicks = 0;
  let totalClicks = 0;
  for (const row of rows) {
    totalClicks += row.clicks;
    const i = keysForXpath(row.xpath).map((k) => index.get(k)).find((v) => v !== undefined);
    if (i === undefined) continue;
    matchedClicks += row.clicks;
    const cur = byElement.get(i) ?? { index: i, clicks: 0, visits: 0 };
    cur.clicks += row.clicks;
    // Visits of several recorded rows on one element can overlap: keep the largest.
    cur.visits = Math.max(cur.visits, row.visits);
    byElement.set(i, cur);
  }
  return { byElement, matchedClicks, totalClicks };
}

// ── Areas at a detail level ──────────────────────────────────────────────────

export interface AreaStat {
  area: MapArea;
  clicks: number;
  elements: MatchedElement[];
}

export function areasAt(map: SnapshotMap, matching: Matching, detail: number): AreaStat[] {
  const byId = new Map(map.areas.map((a) => [a.id, a]));
  const out = new Map<string, AreaStat>();
  for (const m of matching.byElement.values()) {
    const chain = map.elements[m.index].chain;
    if (chain.length === 0) continue;
    const id = chain[Math.min(detail, chain.length) - 1];
    const area = byId.get(id);
    if (!area) continue;
    const stat = out.get(id) ?? { area, clicks: 0, elements: [] };
    stat.clicks += m.clicks;
    stat.elements.push(m);
    out.set(id, stat);
  }
  return Array.from(out.values());
}

/** First level where no area takes more than 75% of the clicks (as on the live page). */
export function startingDetail(map: SnapshotMap, matching: Matching): number {
  let best = { detail: map.detail || 2, count: -1 };
  for (let d = 1; d <= 5; d++) {
    const areas = areasAt(map, matching, d);
    const total = areas.reduce((s, a) => s + a.clicks, 0);
    const top = Math.max(0, ...areas.map((a) => a.clicks));
    if (areas.length >= 2 && total > 0 && top / total <= 0.75) return d;
    if (areas.length > best.count) best = { detail: d, count: areas.length };
  }
  return best.detail;
}

// ── Exposure ─────────────────────────────────────────────────────────────────

/** Share of visits whose deepest point seen is at least `px` from the top. */
export function reachAt(scroll: ScrollDepth | null, px: number): number | null {
  if (!scroll || !scroll.visits) return null;
  if (px <= 0) return 1;
  let reached = 0;
  for (const [depth, visits] of scroll.steps) {
    if (depth >= px) reached += visits;
    else if (depth + scroll.step > px) reached += (visits * (depth + scroll.step - px)) / scroll.step;
  }
  return Math.min(1, reached / scroll.visits);
}

/** Counted as seen when half of it — or its first 300 px, if taller — came into view. */
export function exposureOf(scroll: ScrollDepth | null, box: Box): number | null {
  return reachAt(scroll, box.y + Math.min(box.h / 2, 300));
}

/** Depth reached by a given share of visits (0.5 → half the visits get this far). */
export function depthReachedBy(scroll: ScrollDepth | null, share: number): number | null {
  if (!scroll || !scroll.visits || scroll.steps.length === 0) return null;
  let lo = 0;
  let hi = scroll.steps[scroll.steps.length - 1][0] + scroll.step;
  if ((reachAt(scroll, hi) ?? 0) >= share) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if ((reachAt(scroll, mid) ?? 0) >= share) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ── Metrics shown on the snapshot ────────────────────────────────────────────

export type AreaMetric = "seen" | "share" | "per100" | "conversion";

export const AREA_METRICS: { value: AreaMetric; label: string; needsScroll: boolean; needsGoal?: boolean }[] = [
  { value: "seen", label: "Seen by", needsScroll: true },
  { value: "share", label: "Share of clicks", needsScroll: false },
  { value: "per100", label: "Clicks per 100 views", needsScroll: true },
  { value: "conversion", label: "Conversion after a click", needsScroll: false, needsGoal: true },
];

export interface AreaNumbers {
  seen: number | null; // 0..1
  share: number; // 0..1
  per100: number | null; // clicks per 100 visits that saw it
  conversion: number | null; // 0..1, of the visits that clicked in it
}

export function areaNumbers(
  stat: AreaStat,
  totalClicks: number,
  pageVisits: number,
  scroll: ScrollDepth | null,
  conversions: ConversionMatching | null = null,
): AreaNumbers {
  const seen = exposureOf(scroll, stat.area.box);
  const seenVisits = seen !== null ? seen * pageVisits : 0;
  let conversion: number | null = null;
  if (conversions) {
    let visits = 0;
    let converted = 0;
    for (const m of stat.elements) {
      const c = conversions.get(m.index);
      if (c) {
        visits += c.visits;
        converted += c.converted;
      }
    }
    conversion = visits > 0 ? converted / visits : null;
  }
  return {
    seen,
    share: totalClicks ? stat.clicks / totalClicks : 0,
    per100: seen !== null && seenVisits > 0 ? (100 * stat.clicks) / seenVisits : null,
    conversion,
  };
}

export function metricValue(n: AreaNumbers, metric: AreaMetric): number | null {
  return metric === "seen" ? n.seen : metric === "share" ? n.share : metric === "per100" ? n.per100 : n.conversion;
}

// ── Conversions ──────────────────────────────────────────────────────────────

/** Map element index → visits that clicked it and how many reached the goal afterwards. */
export type ConversionMatching = Map<number, { visits: number; converted: number }>;

export function matchConversions(map: SnapshotMap, rows: { xpath: string[]; visits: number; converted: number }[]): ConversionMatching {
  const index = new Map<string, number>();
  map.elements.forEach((e, i) => {
    for (const k of e.keys) if (!index.has(k)) index.set(k, i);
  });
  const out: ConversionMatching = new Map();
  for (const row of rows) {
    const i = keysForXpath(row.xpath).map((k) => index.get(k)).find((v) => v !== undefined);
    if (i === undefined) continue;
    const cur = out.get(i) ?? { visits: 0, converted: 0 };
    cur.visits += row.visits;
    cur.converted += row.converted;
    out.set(i, cur);
  }
  return out;
}

export function formatMetric(v: number | null, metric: AreaMetric): string {
  if (v === null) return "–";
  if (metric === "per100") return v >= 10 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1);
  const pct = v * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}

// ── Click heatmap ────────────────────────────────────────────────────────────

export interface PlacedClicks {
  cells: { x: number; y: number; clicks: number }[];
  /** Clicks placed using where the element was at the visitor's window width. */
  exact: number;
  /** Clicks placed within the element, from how its clicks are spread. */
  approx: number;
  /** Clicks on elements that are not on this snapshot. */
  unplaced: number;
}

/**
 * Moves every recorded click onto the snapshot. A click's position is in the
 * layout the visitor saw, which depends on the window width. If the page was
 * measured at about that width, the click keeps its exact spot relative to
 * its element (30% from the left of the button, 60% from its top…), placed on
 * the same element in the snapshot. Otherwise its spot within the element is
 * estimated from how the clicks on that element are spread at that width.
 */
export function placeClicks(
  map: SnapshotMap,
  layouts: Layout[],
  rows: { xpath: string[]; width: number; x: number; y: number; clicks: number }[],
  cell: number,
): PlacedClicks {
  const index = new Map<string, number>();
  map.elements.forEach((e, i) => {
    for (const k of e.keys) if (!index.has(k)) index.set(k, i);
  });
  const elementOf = new Map<string, number | null>();
  const find = (xpath: string[]) => {
    const key = JSON.stringify(xpath);
    if (!elementOf.has(key)) elementOf.set(key, keysForXpath(xpath).map((k) => index.get(k)).find((v) => v !== undefined) ?? null);
    return elementOf.get(key)!;
  };

  const tolerance = (w: number) => Math.max(16, w * 0.03);
  const layoutFor = (w: number) => {
    let best: Layout | null = null;
    for (const l of layouts) if (Math.abs(l.width - w) <= tolerance(w) && (!best || Math.abs(l.width - w) < Math.abs(best.width - w))) best = l;
    return best;
  };

  // Spread of the clicks on each element at each width, for the estimate.
  const spread = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (const r of rows) {
    const i = find(r.xpath);
    if (i === null) continue;
    const k = `${i}|${Math.round(r.width / 8)}`;
    const s = spread.get(k);
    const cx = r.x + cell / 2;
    const cy = r.y + cell / 2;
    if (!s) spread.set(k, { x0: cx, x1: cx, y0: cy, y1: cy });
    else {
      s.x0 = Math.min(s.x0, cx);
      s.x1 = Math.max(s.x1, cx);
      s.y0 = Math.min(s.y0, cy);
      s.y1 = Math.max(s.y1, cy);
    }
  }

  const out = new Map<string, { x: number; y: number; clicks: number }>();
  let exact = 0;
  let approx = 0;
  let unplaced = 0;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  for (const r of rows) {
    const i = find(r.xpath);
    if (i === null) {
      unplaced += r.clicks;
      continue;
    }
    const target = map.elements[i].box;
    const cx = r.x + cell / 2;
    const cy = r.y + cell / 2;
    let rx: number;
    let ry: number;
    const layout = layoutFor(r.width);
    const box = layout ? layout.boxes[String(i)] : undefined;
    if (box && box.w > 0 && box.h > 0) {
      rx = clamp((cx - box.x) / box.w);
      ry = clamp((cy - box.y) / box.h);
      exact += r.clicks;
    } else {
      const s = spread.get(`${i}|${Math.round(r.width / 8)}`)!;
      rx = s.x1 - s.x0 > 6 ? (cx - s.x0) / (s.x1 - s.x0) : 0.5;
      ry = s.y1 - s.y0 > 6 ? (cy - s.y0) / (s.y1 - s.y0) : 0.5;
      approx += r.clicks;
    }
    const x = target.x + rx * target.w;
    const y = target.y + ry * target.h;
    const k = `${Math.round(x / cell)}|${Math.round(y / cell)}`;
    const c = out.get(k) ?? { x: Math.round(x / cell) * cell - cell / 2, y: Math.round(y / cell) * cell - cell / 2, clicks: 0 };
    c.clicks += r.clicks;
    out.set(k, c);
  }
  return { cells: Array.from(out.values()), exact, approx, unplaced };
}

/** The layouts of a snapshot; one taken by hand has only its own, from the map. */
export function layoutsOf(snapshot: { viewport: { w: number }; map: SnapshotMap; layouts?: Layout[] }): Layout[] {
  const own: Layout = {
    width: snapshot.viewport.w,
    page: snapshot.map.page,
    boxes: Object.fromEntries(snapshot.map.elements.map((e, i) => [String(i), e.box])),
  };
  const measured = (snapshot.layouts ?? []).filter((l) => Math.abs(l.width - own.width) > 1);
  return [own, ...measured];
}
