/**
 * A saved snapshot with its numbers.
 *
 * - Zones: the page opens with no zone. Pointing at it outlines the block
 *   under the pointer (any block of the page, clicked or not); a click turns
 *   it into a zone, which stays on and shows the chosen metric; another click
 *   turns it off. The "i" on a zone shows its details in the side panel,
 *   with the blocks around it, from the smallest to the largest, to pick the
 *   right one. Zones and their names are saved with the snapshot.
 * - Click heatmap and Scroll heatmap: read through their colors only.
 * - Table: the clicked elements of the page, sortable.
 *
 * One toolbar on top; the page on a grey ground at the size chosen (Fit,
 * 75%, 50%); a side panel next to it that is always there, so the page keeps
 * its size when details open.
 *
 * Numbers are recomputed from the current filters; the snapshot only stores
 * the picture and the map of the page.
 */
import { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { HEAT_CELL, ZONE_MAX_ELEMENTS } from "../dql/queries";
import type { ClickPosition, Conversion, ElementConversion, PageElement, ScrollDepth } from "../hooks/data";
import { formatInt } from "../lib/format";
import {
  chainOf,
  depthReachedBy,
  exposureOf,
  formatShare,
  insideTotals,
  layoutsOf,
  matchClicks,
  matchConversions,
  placeClicks,
  reachAt,
  suggestZones,
  ZONE_METRICS,
  ZoneMetric,
  ZoneNumbers,
  zoneNumbers,
  zoneTree,
  zoneValue,
} from "../lib/snapshotMath";
import type { Box, Snapshot } from "../lib/snapshots";
import { usePersistentState } from "../lib/storage";
import { c } from "../theme";
import { Button } from "@dynatrace/strato-components/buttons";
import { Select } from "@dynatrace/strato-components/forms";
import { Colors } from "@dynatrace/strato-design-tokens";
import { AiIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { Checkbox, Segmented } from "./Controls";
import { ClickHeatLayer, HeatLegend, heatRgb, ScrollHeatLayer } from "./Heatmaps";

export type MapMode = "zones" | "clicks" | "scroll" | "table";
type Zoom = "fit" | "75" | "50";

export interface HeatData {
  rows: ClickPosition[] | null;
  loading: boolean;
  error: string | null;
}

export interface GoalData {
  label: string;
  page: Conversion | null;
  elements: ElementConversion[] | null;
  loading: boolean;
  error: string | null;
}

/** Visits that clicked in a zone, counted by Dynatrace; converted is null without a goal. */
export interface ZoneCount {
  visits: number;
  converted: number | null;
}

type Count = ZoneCount | "loading" | "error";

/** Zone colors on the same cold-to-hot scale as the heatmaps. */
function zoneColor(ratio: number): { fill: string; line: string; bg: string; fg: string } {
  const [r, g, b] = heatRgb(ratio);
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  return { fill: `rgba(${r},${g},${b},0.38)`, line: `rgb(${r},${g},${b})`, bg: `rgb(${r},${g},${b})`, fg: light ? "#16191F" : "#FFFFFF" };
}
const BLUE = Colors.Border.Primary.Accent;


/** Names taken from a line of text come in quotes: drop them for display. */
function clean(name: string): string {
  const m = /^“(.*)”$/.exec(name.trim());
  return m ? m[1] : name;
}

function contains(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

export function SnapshotView(props: {
  snapshot: Snapshot;
  elements: PageElement[];
  scroll: ScrollDepth | null;
  pageVisits: number;
  periodLabel?: string;
  saving: boolean;
  /** Paths of the zones turned on, and names given to zones. */
  zones: string[];
  names: Record<string, string>;
  onZoning: (zones: string[], names: Record<string, string>) => void;
  /** Exact visits (and conversions) of a zone; `countKey` changes with the period and goal. */
  countZone?: (sections: string[]) => Promise<ZoneCount>;
  countKey?: string;
  mode?: MapMode;
  onMode?: (mode: MapMode) => void;
  heat?: HeatData | null;
  goal?: GoalData | null;
}) {
  const { snapshot, scroll, pageVisits } = props;
  const map = snapshot.map;
  const mode: MapMode = props.mode ?? "zones";
  const goal = props.goal ?? null;
  const hasScroll = !!(scroll && scroll.visits);
  const W = map.page.w;
  const H = map.page.h;

  const matching = useMemo(() => matchClicks(map, props.elements), [map, props.elements]);
  const tree = useMemo(() => zoneTree(map), [map]);
  const inside = useMemo(() => insideTotals(map, tree, matching), [map, tree, matching]);
  const conversions = useMemo(() => (goal?.elements ? matchConversions(map, goal.elements) : null), [map, goal?.elements]);
  const byPath = useMemo(() => {
    const m = new Map<string, number>();
    tree.paths.forEach((p, i) => p && !m.has(p) && m.set(p, i));
    return m;
  }, [tree]);
  // Matched elements inside each block (for estimated conversions).
  const indexesInside = useMemo(() => {
    const out = new Map<number, number[]>();
    for (const i of matching.byElement.keys()) for (let j = i; j >= 0; j = tree.parent[j]) out.set(j, [...(out.get(j) ?? []), i]);
    return out;
  }, [matching, tree]);

  const [metric, setMetric] = usePersistentState<ZoneMetric>("fp.zoneMetric2", "rate");
  const metricOptions = ZONE_METRICS.filter((m) => (hasScroll || !m.needsScroll) && (goal || !m.needsGoal));
  const activeMetric: ZoneMetric = metricOptions.some((m) => m.value === metric) ? metric : metricOptions[0].value;
  const [showLines, setShowLines] = useState(true);
  const [storedZoom, setZoom] = usePersistentState<Zoom>("fp.zoom", "fit");
  const zoom: Zoom = storedZoom === "75" || storedZoom === "50" ? storedZoom : "fit";
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [pointerY, setPointerY] = useState<{ pageY: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [overlapNote, setOverlapNote] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Zones on, as element indexes (paths not on this snapshot are ignored).
  const zoneIdx = useMemo(() => props.zones.map((p) => byPath.get(p)).filter((i): i is number => i !== undefined), [props.zones, byPath]);
  const zoneSet = useMemo(() => new Set(zoneIdx), [zoneIdx]);
  const pathOf = (i: number) => tree.paths[i] ?? "";
  const nameOf = (i: number) => props.names[pathOf(i)] || clean(map.elements[i].name);

  useEffect(() => {
    setSelected(null);
    setHover(null);
    setPreview(null);
    setPointerY(null);
  }, [mode]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Exact numbers for the zones turned on ──────────────────────────────────
  const [counts, setCounts] = useState<Map<string, Count>>(() => new Map());
  const sectionsOf = (i: number) => Array.from(new Set(inside[i].rows.map((r) => r.raw).filter((s): s is string => !!s)));
  const countKeyOf = (i: number) => `${props.countKey ?? ""}|${pathOf(i)}`;
  useEffect(() => {
    if (!props.countZone) return;
    for (const i of zoneIdx) {
      const key = countKeyOf(i);
      if (counts.has(key)) continue;
      const sections = sectionsOf(i);
      if (sections.length === 0) {
        setCounts((m) => new Map(m).set(key, { visits: 0, converted: goal ? 0 : null }));
        continue;
      }
      if (sections.length > ZONE_MAX_ELEMENTS) continue;
      setCounts((m) => new Map(m).set(key, "loading"));
      props.countZone(sections).then(
        (r) => setCounts((m) => new Map(m).set(key, r)),
        () => setCounts((m) => new Map(m).set(key, "error")),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneIdx, props.countKey, props.countZone]);

  function numbersOf(i: number): ZoneNumbers {
    const cnt = counts.get(countKeyOf(i));
    const counted = cnt && typeof cnt === "object" ? cnt : null;
    return zoneNumbers(map.elements[i].box, inside[i], matching.totalClicks, pageVisits, scroll, counted, conversions, indexesInside.get(i) ?? []);
  }
  const zoneNums = new Map(zoneIdx.map((i) => [i, numbersOf(i)]));
  const valueOf = (i: number) => zoneValue(zoneNums.get(i) ?? numbersOf(i), activeMetric);
  // Colors spread from the lowest to the highest value among the zones that are on.
  const zoneValues = zoneIdx.map((i) => valueOf(i) ?? 0);
  const maxValue = Math.max(...zoneValues, 0);
  const minValue = Math.min(...zoneValues, maxValue);
  const ratioOf = (i: number) => (maxValue - minValue > 1e-9 ? ((valueOf(i) ?? 0) - minValue) / (maxValue - minValue) : 0.5);

  // ── Changing the zoning ────────────────────────────────────────────────────
  function setZones(next: number[], names = props.names) {
    props.onZoning(Array.from(new Set(next.map(pathOf).filter(Boolean))), names);
  }
  /** Zones never overlap: turning one on turns off any zone it touches (inside, around or across it). */
  function overlaps(a: number, b: number): boolean {
    const p = map.elements[a].box;
    const q = map.elements[b].box;
    const w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
    const h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
    return w > 2 && h > 2;
  }
  function turnOn(i: number, also: number[] = [], openCard = false) {
    const gone = zoneIdx.filter((z) => z !== i && !also.includes(z) && overlaps(z, i));
    setZones([...zoneIdx.filter((z) => !gone.includes(z) && !also.includes(z)), i]);
    setSelected(openCard ? i : null);
    setOverlapNote(gone.length ? `${gone.map(nameOf).join(", ")} turned off: zones cannot overlap.` : null);
  }
  function toggle(i: number) {
    if (zoneSet.has(i)) {
      setZones(zoneIdx.filter((z) => z !== i));
      if (selected === i) setSelected(null);
      setOverlapNote(null);
    } else turnOn(i);
  }
  function replaceZone(from: number, to: number) {
    if (from === to) return;
    turnOn(to, [from], true);
    setPreview(null);
  }
  function rename(i: number, name: string) {
    setZones(zoneIdx, { ...props.names, [pathOf(i)]: name });
  }
  function suggest() {
    const picked = suggestZones(map, tree, inside);
    if (picked.length === 0) {
      setSuggestNote("No clicks recorded on this page in the period: nothing to suggest yet.");
      return;
    }
    // The suggestion replaces the zones that were on.
    setZones(picked);
    setSelected(null);
    setOverlapNote(null);
    const share = picked.reduce((s, i) => s + inside[i].clicks, 0) / Math.max(1, matching.totalClicks);
    setSuggestNote(`These ${picked.length} zones get ${formatShare(share)} of the page's clicks: ${picked.map((i) => nameOf(i)).join(", ")}.`);
  }

  /**
   * What a click would act on: a zone that is on, if the pointer is in one
   * (a click turns it off); otherwise the smallest block under the pointer.
   */
  function blockAt(e: MouseEvent<HTMLDivElement>): number | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const onZone = zoneIdx.filter((i) => contains(map.elements[i].box, x, y)).sort((a, b) => map.elements[a].box.w * map.elements[a].box.h - map.elements[b].box.w * map.elements[b].box.h)[0];
    if (onZone !== undefined) return onZone;
    let best = -1;
    let bestSize = Infinity;
    map.elements.forEach((el, i) => {
      if (!contains(el.box, x, y)) return;
      const size = el.box.w * el.box.h;
      if (size < bestSize) {
        best = i;
        bestSize = size;
      }
    });
    return best >= 0 ? best : null;
  }

  // ── Click heatmap ──────────────────────────────────────────────────────────
  const heat = props.heat ?? null;
  const placed = useMemo(() => (heat?.rows ? placeClicks(map, layoutsOf(snapshot), heat.rows, HEAT_CELL) : null), [heat?.rows, map, snapshot]);
  const placedTotal = placed ? placed.exact + placed.approx : 0;

  // Scroll lines; lines that fall almost on top of each other share one label.
  const lineGroups = useMemo(() => {
    if (!hasScroll) return [];
    const ls = [0.75, 0.5, 0.25]
      .map((share) => ({ share, d: depthReachedBy(scroll, share) }))
      .filter((l): l is { share: number; d: number } => l.d !== null && l.d > 0 && l.d < H);
    const groups: { d: number; shares: number[] }[] = [];
    for (const l of ls) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(l.d - last.d) < Math.max(40, H * 0.015)) last.shares.push(l.share);
      else groups.push({ d: l.d, shares: [l.share] });
    }
    return groups;
  }, [hasScroll, scroll, H]);

  const at = (b: Box): CSSProperties => ({
    left: `${(100 * b.x) / W}%`,
    top: `${(100 * b.y) / H}%`,
    width: `${(100 * b.w) / W}%`,
    height: `${(100 * b.h) / H}%`,
  });

  const coverage = matching.totalClicks ? matching.matchedClicks / matching.totalClicks : 1;
  const notes: string[] = [];
  if (matching.totalClicks && coverage < 0.8) {
    notes.push(
      `Only ${formatShare(coverage)} of this period's clicks are on elements of this snapshot. The page may have changed since it was taken: consider a new snapshot.`,
    );
  }
  if (snapshot.truncated) notes.push("The page is very long: the snapshot stops at 16,000 pixels.");
  if (goal?.error) notes.push(`Could not compute conversions: ${goal.error}`);

  const metricInfo = ZONE_METRICS.find((m) => m.value === activeMetric)!;
  const hoverI = mode === "zones" && hover && hover.i !== selected ? hover.i : null;
  const zoomPct = zoom === "50" ? 50 : zoom === "75" ? 75 : 100;
  const selectedOn = selected !== null && zoneSet.has(selected) ? selected : null;

  function focusZone(i: number) {
    setSelected(selected === i ? null : i);
    canvasRef.current?.querySelector(`[data-zone="${CSS.escape(pathOf(i))}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* One toolbar: the view on the left, what it shows in the middle, actions on the right */}
      <div
        role="toolbar"
        aria-label="Page map"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: 8, border: `1px solid ${c.line}`, borderRadius: 9, background: c.surface }}
      >
        {props.onMode && (
          <Segmented<MapMode>
            label="View"
            value={mode}
            onChange={(m) => props.onMode!(m)}
            options={[
              { value: "zones", label: "Zones" },
              { value: "clicks", label: "Click heatmap" },
              { value: "scroll", label: "Scroll heatmap", disabled: !hasScroll },
              { value: "table", label: "Table" },
            ]}
          />
        )}
        {mode === "zones" && (
          <>
            <Divider />
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: c.muted, position: "relative" }}>
              <span>Show</span>
              <Select<ZoneMetric> value={activeMetric} onChange={(v) => v && setMetric(v)} aria-label="Metric">
                <Select.Content>
                  {metricOptions.map((m) => (
                    <Select.Option key={m.value} value={m.value}>
                      {m.label}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
              <button
                type="button"
                aria-label={`What is ${metricInfo.label}?`}
                aria-expanded={showHelp}
                onClick={(e) => {
                  e.preventDefault();
                  setShowHelp((v) => !v);
                }}
                style={{ width: 24, height: 24, borderRadius: 999, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.muted, cursor: "pointer", fontWeight: 600, fontSize: 12 }}
              >
                i
              </button>
              {showHelp && (
                <span
                  role="note"
                  style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 10, width: 300, padding: "10px 12px", borderRadius: 10, background: c.surface, border: `1px solid ${c.line}`, boxShadow: "0 8px 24px rgba(22,25,31,0.18)", color: c.ink, fontWeight: 500, fontSize: 13 }}
                >
                  <strong>{metricInfo.label}:</strong> {metricInfo.help}
                </span>
              )}
            </div>
            {zoneIdx.length > 1 && <HeatLegend low="Lowest" high="Highest" />}
          </>
        )}
        {mode === "clicks" && (
          <>
            <Divider />
            <HeatLegend low="Fewer clicks" high="More clicks" />
          </>
        )}
        {mode === "scroll" && (
          <>
            <Divider />
            <HeatLegend low="Few visits get here" high="All visits" />
          </>
        )}
        <span style={{ flex: "1 1 0" }} />
        {mode === "zones" && (
          <Button variant="emphasized" onClick={suggest}>
            <Button.Prefix>
              <AiIcon />
            </Button.Prefix>
            Suggest zones
          </Button>
        )}
        {(mode === "zones" || mode === "scroll") && hasScroll && <Toggle label="Scroll lines" checked={showLines} onChange={setShowLines} />}
        {mode !== "table" && (
          <Segmented<Zoom>
            label="Size of the page"
            value={zoom}
            onChange={setZoom}
            options={[
              { value: "fit", label: "Fit" },
              { value: "75", label: "75%" },
              { value: "50", label: "50%" },
            ]}
          />
        )}
      </div>

      {notes.map((n) => (
        <div key={n} role="note" style={{ padding: "10px 12px", borderRadius: 10, background: c.warnSoft, color: c.warnInk, fontSize: 14 }}>
          {n}
        </div>
      ))}

      {mode === "table" ? (
        <TopTable
          map={map}
          matching={matching}
          scroll={scroll}
          pageVisits={pageVisits}
          conversions={conversions}
          goalLabel={goal?.label ?? null}
          nameOf={nameOf}
          onShow={(i) => {
            if (!zoneSet.has(i)) turnOn(i);
            props.onMode?.("zones");
            window.setTimeout(() => setSelected(i), 0);
          }}
        />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          {/* The page, on a grey ground, at the size chosen */}
          <div style={{ flex: "999 1 560px", minWidth: 0, padding: 16, border: `1px solid ${c.line}`, borderRadius: 9, background: c.surfaceAlt }}>
            <div
              ref={canvasRef}
              onMouseMove={(e) => {
                if (mode === "zones") {
                  const i = blockAt(e);
                  setHover(i !== null ? { i, x: e.clientX, y: e.clientY } : null);
                }
                if (mode === "scroll") {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPointerY({ pageY: ((e.clientY - rect.top) / rect.height) * H, x: e.clientX, y: e.clientY });
                }
              }}
              onMouseLeave={() => {
                setHover(null);
                setPointerY(null);
              }}
              onClick={(e) => {
                if (mode !== "zones") return;
                const i = blockAt(e);
                if (i !== null) toggle(i);
              }}
              style={{
                width: `${zoomPct}%`,
                margin: "0 auto",
                position: "relative",
                background: "#FFFFFF",
                boxShadow: "0 2px 10px rgba(0,0,0,0.10)",
                cursor: mode === "zones" ? "pointer" : "default",
              }}
            >
              <img src={snapshot.image.dataUrl} alt={`Snapshot of ${snapshot.title || snapshot.url}`} draggable={false} style={{ display: "block", width: "100%", height: "auto", userSelect: "none" }} />
              {mode === "clicks" && placed && <ClickHeatLayer cells={placed.cells} width={W} height={H} />}
              {mode === "scroll" && hasScroll && <ScrollHeatLayer scroll={scroll!} height={H} />}

              {mode === "zones" &&
                zoneIdx
                  .slice()
                  .sort((a, b) => map.elements[b].box.w * map.elements[b].box.h - map.elements[a].box.w * map.elements[a].box.h)
                  .map((i) => {
                    const v = valueOf(i);
                    const h = zoneColor(ratioOf(i));
                    const isSel = selected === i;
                    const showInfo = isSel || hover?.i === i;
                    return (
                      <div
                        key={i}
                        data-zone={pathOf(i)}
                        style={{
                          position: "absolute",
                          ...at(map.elements[i].box),
                          boxSizing: "border-box",
                          borderRadius: 4,
                          border: isSel ? `3px solid ${BLUE}` : `2px solid ${h.line}`,
                          background: h.fill,
                          pointerEvents: "none",
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(isSel ? null : i);
                          }}
                          title={`${nameOf(i)} — click for details`}
                          style={{
                            position: "absolute",
                            left: 3,
                            top: 3,
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: 0,
                            fontSize: 12,
                            fontWeight: 600,
                            background: isSel ? BLUE : h.bg,
                            color: isSel ? "#FFFFFF" : h.fg,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            pointerEvents: "auto",
                            cursor: "pointer",
                          }}
                        >
                          {formatShare(v)}
                        </button>
                        {showInfo && (
                          <button
                            type="button"
                            aria-label={`Details of ${nameOf(i)}`}
                            title="Details"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(isSel ? null : i);
                            }}
                            style={{
                              position: "absolute",
                              right: 3,
                              top: 3,
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              border: 0,
                              background: BLUE,
                              color: "#FFFFFF",
                              fontSize: 13,
                              fontWeight: 600,
                              fontStyle: "italic",
                              fontFamily: "Georgia, serif",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                              pointerEvents: "auto",
                              cursor: "pointer",
                            }}
                          >
                            i
                          </button>
                        )}
                      </div>
                    );
                  })}

              {showLines &&
                mode !== "clicks" &&
                lineGroups.map((g) => (
                  <div key={g.d} style={{ position: "absolute", left: 0, right: 0, top: `${(100 * g.d) / H}%`, borderTop: `2px dashed rgba(11,86,229,0.85)`, pointerEvents: "none" }}>
                    <span style={{ position: "absolute", right: 8, top: -20, padding: "1px 8px", borderRadius: "6px 6px 0 0", background: BLUE, color: "#FFFFFF", fontSize: 11, fontWeight: 600 }}>
                      {joinShares(g.shares)} of visits see down to here
                    </span>
                  </div>
                ))}

              {hoverI !== null && !zoneSet.has(hoverI) && <Outline box={map.elements[hoverI].box} at={at} dashed />}
              {preview !== null && <Outline box={map.elements[preview].box} at={at} />}
            </div>
          </div>

          {/* The side panel: always there, so the page keeps its size */}
          <aside
            aria-label={mode === "zones" ? "Zones" : mode === "clicks" ? "About the click heatmap" : "About the scroll heatmap"}
            style={{
              flex: "1 1 300px",
              maxWidth: 400,
              minWidth: 0,
              position: "sticky",
              top: 12,
              maxHeight: "calc(100vh - 24px)",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              border: `1px solid ${c.line}`,
              borderRadius: 9,
              background: c.surface,
            }}
          >
            {mode === "zones" && (
              <>
                {suggestNote && <PanelNote onClose={() => setSuggestNote(null)}>✦ {suggestNote}</PanelNote>}
                {overlapNote && <PanelNote onClose={() => setOverlapNote(null)}>{overlapNote}</PanelNote>}
                {selectedOn !== null && (
                  <ZoneDetails
                    name={nameOf(selectedOn)}
                    metric={activeMetric}
                    numbers={numbersOf(selectedOn)}
                    counting={counts.get(countKeyOf(selectedOn)) === "loading"}
                    goal={goal ? { label: goal.label, page: goal.page } : null}
                    chain={chainOf(map, tree, selectedOn).map((j) => ({ i: j, name: nameOf(j) }))}
                    current={selectedOn}
                    onPick={(j) => replaceZone(selectedOn, j)}
                    onPreview={setPreview}
                    onOff={() => toggle(selectedOn)}
                    onClose={() => setSelected(null)}
                  />
                )}
                <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {zoneIdx.length === 0 ? (
                    <>
                      <div style={{ fontWeight: 600 }}>No zone yet</div>
                      <div style={{ fontSize: 13, color: c.muted }}>
                        Point at the page to see its blocks, and click one to turn it into a zone; click it again to turn it off. Or let Footprints suggest the zones that get the most
                        clicks.
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          Zones on ({zoneIdx.length}) · by {metricInfo.label.toLowerCase()}
                        </span>
                        <Button
                          size="condensed"
                          onClick={() => {
                            setZones([]);
                            setSelected(null);
                          }}
                        >
                          Turn all off
                        </Button>
                      </div>
                      {zoneIdx
                        .slice()
                        .sort((a, b) => (valueOf(b) ?? -1) - (valueOf(a) ?? -1))
                        .map((i) => (
                          <ZoneRow
                            key={i}
                            value={formatShare(valueOf(i))}
                            ratio={ratioOf(i)}
                            name={nameOf(i)}
                            suggested={props.names[pathOf(i)] ? clean(map.elements[i].name) : null}
                            selected={selected === i}
                            onSelect={() => focusZone(i)}
                            onRemove={() => toggle(i)}
                            onRename={(name) => rename(i, name)}
                          />
                        ))}
                      <div style={{ fontSize: 12, color: c.muted }}>The “i” on a zone shows its details here.</div>
                    </>
                  )}
                </div>
              </>
            )}
            {mode === "clicks" && (
              <PanelText title="Click heatmap">
                <p style={{ margin: 0 }}>Every click of the period, placed on the element that was clicked. Red where clicks pile up, blue where there are few.</p>
                {heat?.loading && <p style={{ margin: 0, color: c.muted }}>Placing the clicks…</p>}
                {heat?.error && <p style={{ margin: 0, color: c.criticalInk }}>Could not load click positions: {heat.error}</p>}
                {placed && !heat?.loading && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                    <Stat label="Clicks placed" value={formatInt(placedTotal)} accent />
                    <Stat label="At their exact spot" value={formatShare(placedTotal ? placed.exact / placedTotal : 0)} title="Clicks placed where they happened, measured at the visitor's window width" />
                    <Stat label="Estimated in their element" value={formatShare(placedTotal ? placed.approx / placedTotal : 0)} />
                    <Stat label="On elements not here" value={formatInt(placed.unplaced)} title="Clicks on elements that are not on this snapshot" />
                  </div>
                )}
              </PanelText>
            )}
            {mode === "scroll" && hasScroll && (
              <PanelText title="Scroll heatmap">
                <p style={{ margin: 0 }}>How far down the page visits get. Red near the top, where everybody is; blue down where few visits arrive. Point at the page to read the share at any height.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[0.75, 0.5, 0.25].map((share) => {
                    const d = depthReachedBy(scroll, share);
                    return (
                      <Stat
                        key={share}
                        label={`${Math.round(share * 100)}% of visits see`}
                        value={d === null ? "–" : d >= H ? "The whole page" : `The top ${Math.max(1, Math.round((100 * d) / H))}% of the page`}
                      />
                    );
                  })}
                </div>
                <p style={{ margin: 0, color: c.muted, fontSize: 12 }}>{formatInt(scroll!.visits)} visits in the period.</p>
              </PanelText>
            )}
          </aside>
        </div>
      )}

      {pointerY && hasScroll && (
        <HoverCard x={pointerY.x} y={pointerY.y} width={240}>
          <span style={{ fontSize: 20, fontWeight: 600, color: "#B8461A" }}>{formatShare(reachAt(scroll, pointerY.pageY))}</span>{" "}
          <span style={{ color: c.muted }}>of visits scroll down to here</span>
        </HoverCard>
      )}
    </div>
  );
}

function joinShares(shares: number[]): string {
  const p = shares.map((s) => `${Math.round(s * 100)}%`);
  return p.length === 1 ? p[0] : `${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}`;
}


function Outline(props: { box: Box; at: (b: Box) => CSSProperties; dashed?: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        ...props.at(props.box),
        boxSizing: "border-box",
        borderRadius: 4,
        border: `3px ${props.dashed ? "dashed" : "solid"} ${BLUE}`,
        boxShadow: "0 0 0 3px rgba(11,86,229,0.2)",
        pointerEvents: "none",
      }}
    />
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Checkbox label={props.label} checked={props.checked} onChange={props.onChange} />;
}

function HoverCard(props: { x: number; y: number; children: ReactNode; width?: number }) {
  const width = props.width ?? 300;
  const left = Math.min(props.x + 16, window.innerWidth - width - 12);
  const top = Math.min(props.y + 16, window.innerHeight - 120);
  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: Math.max(12, left),
        top: Math.max(12, top),
        width,
        zIndex: 20,
        pointerEvents: "none",
        background: c.surface,
        color: c.ink,
        border: `1px solid ${c.line}`,
        borderRadius: 12,
        boxShadow: "0 8px 28px rgba(22,25,31,0.22)",
        padding: 12,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {props.children}
    </div>
  );
}

function Stat(props: { label: string; value: string; accent?: boolean; title?: string }) {
  return (
    <div title={props.title} style={{ background: props.accent ? c.accentSoft : c.surfaceAlt, borderRadius: 8, padding: "6px 8px" }}>
      <div style={{ fontSize: 11, color: c.muted }}>{props.label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: props.accent ? c.accent : c.ink }}>{props.value}</div>
    </div>
  );
}

const kicker: CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: c.muted };

function Divider() {
  return <span aria-hidden="true" style={{ width: 1, height: 24, background: c.line }} />;
}

/** A short message at the top of the side panel, with a close button. */
function PanelNote(props: { children: ReactNode; onClose: () => void }) {
  return (
    <div role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "space-between", padding: "10px 12px 10px 16px", background: c.accentSoft, borderBottom: `1px solid ${c.line}`, fontSize: 13 }}>
      <span>{props.children}</span>
      <Button size="condensed" aria-label="Dismiss" onClick={props.onClose}>
        <Button.Prefix>
          <XmarkIcon />
        </Button.Prefix>
      </Button>
    </div>
  );
}

function PanelText(props: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{props.title}</div>
      {props.children}
    </div>
  );
}

/** The details of a zone, in the side panel: its numbers, and the blocks around it to pick a larger or smaller one. */
function ZoneDetails(props: {
  name: string;
  metric: ZoneMetric;
  numbers: ZoneNumbers;
  counting: boolean;
  goal: { label: string; page: Conversion | null } | null;
  chain: { i: number; name: string }[];
  current: number;
  onPick: (i: number) => void;
  onPreview: (i: number | null) => void;
  onOff: () => void;
  onClose: () => void;
}) {
  const n = props.numbers;
  const approx = n.exact ? "" : "≈ ";
  return (
    <section aria-label="Selected zone" style={{ padding: "12px 16px", borderBottom: `1px solid ${c.line}`, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={kicker}>Zone</div>
          <div style={{ fontWeight: 600, fontSize: 16, overflowWrap: "anywhere" }}>{props.name}</div>
        </div>
        <Button size="condensed" aria-label="Close" onClick={props.onClose}>
          <Button.Prefix>
            <XmarkIcon />
          </Button.Prefix>
        </Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        <Stat label="Click rate" value={n.rate === null ? "–" : `${approx}${formatShare(n.rate)}`} accent={props.metric === "rate"} title="Of the visits that saw the zone, the share that clicked in it" />
        <Stat label="Click share" value={formatShare(n.share)} accent={props.metric === "share"} title="Of all the clicks on the page, the share that happens in this zone" />
        <Stat label="Exposure" value={formatShare(n.exposure)} accent={props.metric === "exposure"} title="Share of visits that scrolled far enough to see the zone" />
        <Stat label="Clicks" value={formatInt(n.clicks)} />
      </div>
      <div style={{ color: c.muted }}>{props.counting ? "Counting the visits that clicked here…" : `${n.exact ? "" : "At least "}${formatInt(n.visits)} visits clicked here.`}</div>
      {props.goal && (
        <div style={{ padding: "8px 10px", borderRadius: 8, background: props.metric === "conversion" ? c.accentSoft : c.surfaceAlt }}>
          <div style={{ fontSize: 12, color: c.muted }}>Reached “{props.goal.label}” after a click here</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {n.conversion === null ? "–" : `${approx}${formatShare(n.conversion)}`}
            {props.goal.page && props.goal.page.visits > 0 && (
              <span style={{ fontSize: 12, fontWeight: 500, color: c.muted }}> · page average {formatShare(props.goal.page.converted / props.goal.page.visits)}</span>
            )}
          </div>
        </div>
      )}
      {props.chain.length > 1 && (
        <div>
          <div style={{ fontSize: 12, color: c.muted, marginBottom: 4 }}>Pick the block, from the smallest to the largest:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }} onMouseLeave={() => props.onPreview(null)}>
            {props.chain.map((l, k) => {
              const on = l.i === props.current;
              return (
                <button
                  key={l.i}
                  type="button"
                  aria-pressed={on}
                  onClick={() => props.onPick(l.i)}
                  onMouseEnter={() => props.onPreview(on ? null : l.i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minHeight: 28,
                    padding: "0 8px",
                    paddingLeft: 8 + k * 10,
                    borderRadius: 6,
                    border: 0,
                    background: on ? c.accentSoft : "transparent",
                    color: on ? c.accent : c.ink,
                    fontWeight: on ? 600 : 400,
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <span aria-hidden="true" style={{ color: c.muted }}>
                    {k === 0 ? "▪" : "└"}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <Button size="condensed" onClick={props.onOff}>
          Turn this zone off
        </Button>
      </div>
    </section>
  );
}

function ZoneRow(props: {
  value: string;
  ratio: number;
  name: string;
  suggested: string | null;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== props.name) props.onRename(name);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(props.name);
      setEditing(false);
    }
  }

  const h = zoneColor(props.ratio);
  const iconButton: CSSProperties = { width: 28, height: 28, flex: "none", borderRadius: 6, border: 0, background: "transparent", color: c.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 4px",
        borderRadius: 6,
        background: props.selected ? c.accentSoft : "transparent",
      }}
    >
      <span style={{ minWidth: 50, textAlign: "center", padding: "1px 6px", borderRadius: 999, fontWeight: 600, fontSize: 12, background: h.bg, color: h.fg }}>{props.value}</span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label="Zone name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          maxLength={60}
          style={{ flex: 1, minWidth: 0, minHeight: 34, padding: "0 8px", borderRadius: 8, border: `1px solid ${c.accent}`, background: c.surface, color: c.ink, fontSize: 14 }}
        />
      ) : (
        <button type="button" onClick={props.onSelect} style={{ flex: 1, minWidth: 0, textAlign: "left", border: 0, background: "transparent", color: c.ink, cursor: "pointer", padding: 0, minHeight: 30 }}>
          <span style={{ display: "block", fontWeight: props.selected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.name}</span>
          {props.suggested && <span style={{ display: "block", fontSize: 12, color: c.muted }}>Suggested: {props.suggested}</span>}
        </button>
      )}
      {!editing && (
        <>
          <button
            type="button"
            aria-label={`Rename ${props.name}`}
            onClick={() => {
              setDraft(props.name);
              setEditing(true);
            }}
            style={iconButton}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button type="button" aria-label={`Turn ${props.name} off`} onClick={props.onRemove} style={iconButton}>
            ✕
          </button>
        </>
      )}
    </div>
  );
}

type SortKey = "clicks" | "share" | "visits" | "rate" | "exposure" | "conversion";

/** The clicked elements of the page, sortable; "Show" turns one into a zone on the picture. */
function TopTable(props: {
  map: Snapshot["map"];
  matching: ReturnType<typeof matchClicks>;
  scroll: ScrollDepth | null;
  pageVisits: number;
  conversions: ReturnType<typeof matchConversions> | null;
  goalLabel: string | null;
  nameOf: (i: number) => string;
  onShow: (i: number) => void;
}) {
  const [sort, setSort] = usePersistentState<SortKey>("fp.tableSort", "clicks");
  const rows = Array.from(props.matching.byElement.values()).map((m) => {
    const box = props.map.elements[m.index].box;
    const exposure = exposureOf(props.scroll, box);
    const seen = exposure !== null ? exposure * props.pageVisits : props.pageVisits;
    const conv = props.conversions?.get(m.index);
    return {
      i: m.index,
      name: props.nameOf(m.index),
      clicks: m.clicks,
      share: props.matching.totalClicks ? m.clicks / props.matching.totalClicks : 0,
      visits: m.visits,
      rate: seen > 0 ? Math.min(1, m.visits / seen) : null,
      exposure,
      conversion: conv && conv.visits ? conv.converted / conv.visits : null,
    };
  });
  rows.sort((a, b) => ((b[sort] as number | null) ?? -1) - ((a[sort] as number | null) ?? -1));
  const cols: { key: SortKey; label: string; show: boolean; fmt: (r: (typeof rows)[number]) => string }[] = [
    { key: "clicks", label: "Clicks", show: true, fmt: (r) => formatInt(r.clicks) },
    { key: "share", label: "Click share", show: true, fmt: (r) => formatShare(r.share) },
    { key: "visits", label: "Visits clicking", show: true, fmt: (r) => formatInt(r.visits) },
    { key: "rate", label: "Click rate", show: !!props.scroll, fmt: (r) => formatShare(r.rate) },
    { key: "exposure", label: "Exposure", show: !!props.scroll, fmt: (r) => formatShare(r.exposure) },
    { key: "conversion", label: "Conversion", show: !!props.goalLabel, fmt: (r) => formatShare(r.conversion) },
  ];
  const shown = cols.filter((col) => col.show);
  const cell: CSSProperties = { padding: "8px 10px", borderBottom: `1px solid ${c.line}`, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  if (rows.length === 0) return <div style={{ color: c.muted }}>Nobody clicked on this page in the selected period.</div>;
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: "left" }}>Element</th>
            {shown.map((col) => (
              <th key={col.key} style={cell} aria-sort={sort === col.key ? "descending" : "none"}>
                <button type="button" onClick={() => setSort(col.key)} style={{ border: 0, background: "transparent", color: sort === col.key ? c.accent : c.ink, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                  {col.label}
                  {sort === col.key ? " ▾" : ""}
                </button>
              </th>
            ))}
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r) => (
            <tr key={r.i}>
              <td style={{ ...cell, textAlign: "left", whiteSpace: "normal", maxWidth: 360 }}>{r.name}</td>
              {shown.map((col) => (
                <td key={col.key} style={{ ...cell, fontWeight: sort === col.key ? 700 : 400 }}>
                  {col.fmt(r)}
                </td>
              ))}
              <td style={cell}>
                <Button size="condensed" onClick={() => props.onShow(r.i)}>
                  Show
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
