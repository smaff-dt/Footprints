/**
 * A saved snapshot with its numbers: the picture of the page, each area
 * colored by the chosen metric (only the number is drawn on the page), and
 * any element of the page — clicked or not — can be pointed at or selected to
 * read its numbers. A sidebar ranks the areas and lets you rename them.
 * Numbers are recomputed from the current filters; the snapshot only stores
 * the picture and the map.
 */
import { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ClickPosition, Conversion, ElementConversion, PageElement, ScrollDepth } from "../hooks/data";
import { HEAT_CELL } from "../dql/queries";
import { ClickHeatLayer, HeatLegend, ScrollHeatLayer } from "./Heatmaps";
import { deviceName, formatInt, formatWhen } from "../lib/format";
import { usePersistentState } from "../lib/storage";
import {
  AREA_METRICS,
  AreaMetric,
  areaNumbers,
  AreaStat,
  areasAt,
  depthReachedBy,
  exposureOf,
  formatMetric,
  matchClicks,
  matchConversions,
  layoutsOf,
  placeClicks,
  MatchedElement,
  reachAt,
  metricValue,
  startingDetail,
} from "../lib/snapshotMath";
import type { Box, Snapshot } from "../lib/snapshots";
import { c } from "../theme";

export type MapMode = "areas" | "clicks" | "scroll";

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

type Target = { kind: "element"; index: number } | { kind: "area"; id: string };
type Hover = (Target & { x: number; y: number }) | null;

const HEAT = ["#F6D9A8", "#EE9B4D", "#B8461A"];

function chipColors(ratio: number): { bg: string; fg: string } {
  if (ratio >= 0.66) return { bg: HEAT[2], fg: "#FFFFFF" };
  if (ratio >= 0.33) return { bg: HEAT[1], fg: "#16191F" };
  return { bg: HEAT[0], fg: "#16191F" };
}

function pctOf(n: number, total: number): string {
  if (!total) return "–";
  const v = Math.min(100, (100 * n) / total);
  return v > 0 && v < 0.1 ? "<0.1%" : `${v.toFixed(v >= 10 ? 0 : 1)}%`;
}

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
  deviceKey: string;
  saving: boolean;
  onRename: (areaKey: string, name: string) => void;
  mode?: MapMode;
  onMode?: (mode: MapMode) => void;
  heat?: HeatData | null;
  goal?: GoalData | null;
}) {
  const { snapshot, scroll, pageVisits } = props;
  const mode: MapMode = props.mode ?? "areas";
  const goal = props.goal ?? null;
  const map = snapshot.map;
  const matching = useMemo(() => matchClicks(map, props.elements), [map, props.elements]);
  const hasScroll = !!(scroll && scroll.visits);
  const conversions = useMemo(() => (goal?.elements ? matchConversions(map, goal.elements) : null), [map, goal?.elements]);

  const [metric, setMetric] = useState<AreaMetric>("seen");
  const [detail, setDetail] = useState<number>(() => startingDetail(map, matching));
  const [showDots, setShowDots] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [sidebar, setSidebar] = usePersistentState("fp.sidebar", false);
  const [hover, setHover] = useState<Hover>(null);
  const [pointerY, setPointerY] = useState<{ pageY: number; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<Target | null>(null);
  // Areas hidden from the picture (by key, so the choice survives a change of detail).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggleArea = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  useEffect(() => setHidden(new Set()), [snapshot]);
  // Esc clears the selection.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setPinned(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const canvasRef = useRef<HTMLDivElement>(null);

  // A new snapshot or new data: start again from a sensible detail level.
  useEffect(() => setDetail(startingDetail(map, matching)), [map, matching]);
  useEffect(() => setPinned((p) => (p && p.kind === "area" ? null : p)), [detail]);
  const metricOptions = AREA_METRICS.filter((m) => (hasScroll || !m.needsScroll) && (conversions || !m.needsGoal));
  const activeMetric: AreaMetric = metricOptions.some((m) => m.value === metric) ? metric : "share";

  const stats = useMemo(() => areasAt(map, matching, detail), [map, matching, detail]);
  const statById = useMemo(() => new Map(stats.map((s) => [s.area.id, s])), [stats]);
  const numbers = useMemo(
    () => new Map(stats.map((s) => [s.area.id, areaNumbers(s, matching.totalClicks, pageVisits, scroll, conversions)])),
    [stats, matching.totalClicks, pageVisits, scroll, conversions],
  );
  const valueOf = (s: AreaStat) => metricValue(numbers.get(s.area.id)!, activeMetric) ?? 0;
  const maxValue = Math.max(1e-9, ...stats.map(valueOf));
  const ranked = stats.slice().sort((a, b) => valueOf(b) - valueOf(a));
  const nameOf = (s: AreaStat) => snapshot.names[s.area.key] || clean(s.area.name);

  const W = map.page.w;
  const H = map.page.h;
  const at = (b: Box): CSSProperties => ({
    left: `${(100 * b.x) / W}%`,
    top: `${(100 * b.y) / H}%`,
    width: `${(100 * b.w) / W}%`,
    height: `${(100 * b.h) / H}%`,
  });

  const matched = Array.from(matching.byElement.values());
  const maxClicks = Math.max(1, ...matched.map((m) => m.clicks));

  // Scroll lines; lines that fall almost on top of each other share one label.
  const lineGroups = useMemo(() => {
    if (!hasScroll) return [];
    const lines = [0.75, 0.5, 0.25]
      .map((share) => ({ share, d: depthReachedBy(scroll, share) }))
      .filter((l): l is { share: number; d: number } => l.d !== null && l.d > 0 && l.d < H);
    const groups: { d: number; shares: number[] }[] = [];
    for (const l of lines) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(l.d - last.d) < Math.max(40, H * 0.015)) last.shares.push(l.share);
      else groups.push({ d: l.d, shares: [l.share] });
    }
    return groups;
  }, [hasScroll, scroll, H]);

  /** The smallest element of the page under the pointer, clicked or not; else the smallest area. */
  function targetAt(e: MouseEvent<HTMLDivElement>): Target | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
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
    if (best >= 0) return { kind: "element", index: best };
    let area: AreaStat | null = null;
    for (const s of stats) if (!hidden.has(s.area.key) && contains(s.area.box, x, y) && (!area || s.area.box.w * s.area.box.h < area.area.box.w * area.area.box.h)) area = s;
    return area ? { kind: "area", id: area.area.id } : null;
  }

  function sameTarget(a: Target | null, b: Target | null): boolean {
    if (!a || !b) return a === b;
    return a.kind === b.kind && (a.kind === "element" ? a.index === (b as typeof a).index : a.id === (b as typeof a).id);
  }

  function focusArea(id: string) {
    if (pinned?.kind === "area" && pinned.id === id) {
      setPinned(null); // a second click deselects
      return;
    }
    setPinned({ kind: "area", id });
    const node = canvasRef.current?.querySelector<HTMLElement>(`[data-area="${CSS.escape(id)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const coverage = matching.totalClicks ? matching.matchedClicks / matching.totalClicks : 1;
  const notes: string[] = [];
  if (matching.totalClicks && coverage < 0.8) {
    notes.push(
      `Only ${pctOf(matching.matchedClicks, matching.totalClicks)} of this period's clicks are on elements of this snapshot. The page may have changed since it was taken: consider a new snapshot.`,
    );
  }
  if (props.deviceKey === "all" && hasScroll) {
    notes.push("“Seen by” mixes desktop and mobile visits, whose pages have different lengths. Choose one device for exact numbers.");
  }
  if (snapshot.truncated) notes.push("The page is very long: the snapshot stops at 16,000 pixels.");
  if (goal?.error) notes.push(`Could not compute conversions: ${goal.error}`);

  // Click heatmap: every click moved onto the snapshot (see placeClicks).
  const heat = props.heat ?? null;
  const placed = useMemo(
    () => (heat?.rows ? placeClicks(map, layoutsOf(snapshot), heat.rows, HEAT_CELL) : null),
    [heat?.rows, map, snapshot],
  );
  const placedTotal = placed ? placed.exact + placed.approx : 0;

  const hl = (t: Target | null): Box | null =>
    !t ? null : t.kind === "element" ? map.elements[t.index]?.box ?? null : statById.get(t.id)?.area.box ?? null;
  const hoverBox = hover && !sameTarget(hover, pinned) ? hl(hover) : null;
  const pinnedBox = hl(pinned);

  // The structural path of each element ("html[1]/body[1]/…"), to know what contains what.
  const paths = useMemo(() => map.elements.map((e) => e.keys.find((k) => k.startsWith("html[1]/")) ?? null), [map]);

  /** Clicks recorded on elements inside this one, and on the nearest clicked element around it. */
  function related(index: number): Related {
    const path = paths[index];
    if (!path) return { inside: 0, insideCount: 0, around: null };
    let inside = 0;
    let insideCount = 0;
    let around: Related["around"] = null;
    for (const m of matching.byElement.values()) {
      if (m.index === index) continue;
      const p = paths[m.index];
      if (!p) continue;
      if (p.startsWith(`${path}/`)) {
        inside += m.clicks;
        insideCount += 1;
      } else if (path.startsWith(`${p}/`) && (!around || p.length > around.depth)) {
        around = { name: map.elements[m.index].name, clicks: m.clicks, visits: m.visits, depth: p.length };
      }
    }
    return { inside, insideCount, around };
  }

  function cardFor(t: Target): ReactNode {
    if (t.kind === "element") {
      const el = map.elements[t.index];
      return (
        <ElementCard
          related={related(t.index)}
          goal={goal && conversions ? { label: goal.label, page: goal.page, mine: conversions.get(t.index) ?? null } : null}
          name={el.name}
          m={matching.byElement.get(t.index) ?? null}
          seen={exposureOf(scroll, el.box)}
          pageVisits={pageVisits}
          totalClicks={matching.totalClicks}
          area={(() => {
            const id = el.chain.length ? el.chain[Math.min(detail, el.chain.length) - 1] : null;
            const s = id ? statById.get(id) : undefined;
            return s ? nameOf(s) : null;
          })()}
        />
      );
    }
    const s = statById.get(t.id);
    return s ? (
      <AreaCard
        stat={s}
        name={nameOf(s)}
        numbers={numbers.get(s.area.id)!}
        snapshot={snapshot}
        pageVisits={pageVisits}
        goal={goal && conversions ? { label: goal.label, page: goal.page } : null}
      />
    ) : null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Top bar: what to show */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px" }}>
        {props.onMode && (
          <div role="radiogroup" aria-label="View" style={{ display: "flex", padding: 3, borderRadius: 12, background: c.surfaceAlt, border: `1px solid ${c.line}` }}>
            {(
              [
                ["areas", "Areas"],
                ["clicks", "Click heatmap"],
                ["scroll", "Scroll heatmap"],
              ] as [MapMode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                disabled={value === "scroll" && !hasScroll}
                onClick={() => props.onMode!(value)}
                style={{
                  minHeight: 36,
                  padding: "0 14px",
                  borderRadius: 9,
                  border: 0,
                  background: mode === value ? c.surface : "transparent",
                  boxShadow: mode === value ? "0 1px 3px rgba(22,25,31,0.18)" : "none",
                  color: c.ink,
                  fontWeight: mode === value ? 700 : 500,
                  cursor: value === "scroll" && !hasScroll ? "not-allowed" : "pointer",
                  opacity: value === "scroll" && !hasScroll ? 0.5 : 1,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {mode === "areas" && (
        <>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: c.muted }}>
          Show
          <select
            value={activeMetric}
            onChange={(e) => setMetric(e.target.value as AreaMetric)}
            style={{ minHeight: 40, padding: "0 10px", borderRadius: 10, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.ink, fontWeight: 700 }}
          >
            {metricOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: c.muted }}>
          Detail
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={detail}
            onChange={(e) => setDetail(Number(e.target.value))}
            aria-label="Detail: fewer, larger areas to more, smaller ones"
            style={{ width: 140, accentColor: "#2F4BD8" }}
          />
        </label>
        <Toggle label="Clicked elements" checked={showDots} onChange={setShowDots} />
        </>
        )}
        {mode === "clicks" && <HeatLegend low="Fewer clicks" high="More clicks" />}
        {mode === "scroll" && <HeatLegend low="Few visits get here" high="All visits" />}
        {hasScroll && mode !== "clicks" && <Toggle label="Scroll lines" checked={showLines} onChange={setShowLines} />}
        <button
          type="button"
          onClick={() => setSidebar(!sidebar)}
          aria-expanded={sidebar}
          style={{
            marginLeft: "auto",
            minHeight: 38,
            padding: "0 14px",
            borderRadius: 10,
            border: `1px solid ${c.lineStrong}`,
            background: sidebar ? c.accentSoft : c.surface,
            color: c.ink,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {sidebar ? "Hide areas" : "Show areas"}
        </button>
      </div>

      <div style={{ fontSize: 13, color: c.muted }}>
        Snapshot of {formatWhen(snapshot.capturedAt)} · {deviceName(snapshot.device)} page
        {props.deviceKey !== "all" ? ` · numbers from ${props.deviceKey} visits` : ""} · {pctOf(matching.matchedClicks, matching.totalClicks)} of this
        period's clicks are on it · point at anything on the page, click to select it
        {props.saving ? " · saving names…" : ""}
        {goal && (goal.loading ? " · computing conversions…" : goal.page ? ` · goal “${goal.label}”: ${pctOf(goal.page.converted, goal.page.visits)} of visits reach it` : "")}
      </div>
      {mode === "clicks" && heat && (
        <div style={{ fontSize: 13, color: c.muted }}>
          {heat.loading
            ? "Placing the clicks…"
            : heat.error
              ? `Could not load click positions: ${heat.error}`
              : placed
                ? `${formatInt(placedTotal)} clicks placed: ${pctOf(placed.exact, placedTotal)} at their exact spot (the page was measured at the visitor's window width), ${pctOf(
                    placed.approx,
                    placedTotal,
                  )} estimated within their element${placed.unplaced ? ` · ${formatInt(placed.unplaced)} clicks are on elements not on this snapshot` : ""}.`
                : ""}
        </div>
      )}
      {notes.map((n) => (
        <div key={n} role="note" style={{ padding: "10px 12px", borderRadius: 10, background: c.warnSoft, color: c.warnInk, fontSize: 14 }}>
          {n}
        </div>
      ))}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        {/* The page */}
        <div
          ref={canvasRef}
          onMouseMove={(e) => {
            const t = targetAt(e);
            setHover(t ? { ...t, x: e.clientX, y: e.clientY } : null);
            const rect = e.currentTarget.getBoundingClientRect();
            setPointerY(mode === "scroll" ? { pageY: ((e.clientY - rect.top) / rect.height) * H, x: e.clientX, y: e.clientY } : null);
          }}
          onMouseLeave={() => {
            setHover(null);
            setPointerY(null);
          }}
          onClick={(e) => {
            const t = targetAt(e);
            setPinned((p) => (sameTarget(p, t) ? null : t));
          }}
          style={{
            flex: "999 1 560px",
            minWidth: 0,
            position: "relative",
            border: `1px solid ${c.lineStrong}`,
            borderRadius: 10,
            overflow: "hidden",
            background: "#FFFFFF",
            cursor: "crosshair",
          }}
        >
          <img src={snapshot.image.dataUrl} alt={`Snapshot of ${snapshot.title || snapshot.url}`} draggable={false} style={{ display: "block", width: "100%", height: "auto", userSelect: "none" }} />
          {mode === "clicks" && placed && <ClickHeatLayer cells={placed.cells} width={W} height={H} />}
          {mode === "scroll" && hasScroll && <ScrollHeatLayer scroll={scroll!} height={H} />}
          {stats
            .filter((s) => mode === "areas" && !hidden.has(s.area.key))
            .sort((a, b) => b.area.box.w * b.area.box.h - a.area.box.w * a.area.box.h)
            .map((s) => {
              const r = valueOf(s) / maxValue;
              const h = chipColors(r);
              const isSel = pinned?.kind === "area" && pinned.id === s.area.id;
              return (
                <div
                  key={s.area.id}
                  data-area={s.area.id}
                  style={{
                    position: "absolute",
                    ...at(s.area.box),
                    boxSizing: "border-box",
                    borderRadius: 6,
                    border: isSel ? "3px solid #2F4BD8" : "2px solid rgba(184,70,26,0.75)",
                    background: `rgba(232,116,46,${(0.1 + 0.4 * r).toFixed(2)})`,
                    pointerEvents: "none",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: 4,
                      top: 4,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 800,
                      background: isSel ? "#2F4BD8" : h.bg,
                      color: isSel ? "#FFFFFF" : h.fg,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                    }}
                  >
                    {formatMetric(metricValue(numbers.get(s.area.id)!, activeMetric), activeMetric)}
                  </span>
                </div>
              );
            })}
          {showLines && mode !== "clicks" &&
            lineGroups.map((g) => (
              <div key={g.d} style={{ position: "absolute", left: 0, right: 0, top: `${(100 * g.d) / H}%`, borderTop: "2px dashed rgba(47,75,216,0.85)", pointerEvents: "none" }}>
                <span style={{ position: "absolute", right: 8, top: -20, padding: "1px 8px", borderRadius: "6px 6px 0 0", background: "#2F4BD8", color: "#FFFFFF", fontSize: 11, fontWeight: 700 }}>
                  {joinShares(g.shares)} of visits see down to here
                </span>
              </div>
            ))}
          {showDots && mode === "areas" &&
            matched.map((m) => {
              const e = map.elements[m.index];
              const size = 8 + Math.round(14 * Math.sqrt(m.clicks / maxClicks));
              return (
                <div
                  key={m.index}
                  style={{
                    position: "absolute",
                    left: `${(100 * (e.box.x + e.box.w / 2)) / W}%`,
                    top: `${(100 * (e.box.y + e.box.h / 2)) / H}%`,
                    width: size,
                    height: size,
                    transform: "translate(-50%, -50%)",
                    borderRadius: "50%",
                    background: "rgba(47,75,216,0.85)",
                    border: "2px solid #FFFFFF",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                    pointerEvents: "none",
                  }}
                />
              );
            })}
          {hoverBox && <Outline box={hoverBox} at={at} dashed />}
          {pinnedBox && <Outline box={pinnedBox} at={at} />}
          {pinned && pinnedBox && (
            <section
              aria-label="Selected"
              onClick={(e) => e.stopPropagation()}
              onMouseMove={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                zIndex: 5,
                width: 300,
                maxWidth: "45%",
                ...(pinnedBox.y < H - 520 ? { top: `${(100 * pinnedBox.y) / H}%` } : { bottom: 8 }),
                // Next to the selection, on the side with more room.
                ...(pinnedBox.x + pinnedBox.w / 2 < W / 2
                  ? { left: `calc(${(100 * (pinnedBox.x + pinnedBox.w)) / W}% + 12px)` }
                  : { right: `calc(${100 - (100 * pinnedBox.x) / W}% + 12px)` }),
                border: `2px solid ${c.accent}`,
                borderRadius: 12,
                padding: 12,
                background: c.surface,
                color: c.ink,
                boxShadow: "0 8px 28px rgba(22,25,31,0.25)",
                fontSize: 13,
                lineHeight: 1.45,
                cursor: "default",
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -6 }}>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setPinned(null)}
                  style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${c.line}`, background: c.surface, color: c.muted, cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
              {cardFor(pinned)}
            </section>
          )}
        </div>

        {/* Sidebar: the selection, then the areas ranked by the chosen metric, with renaming */}
        {sidebar && (
          <aside
            aria-label="Areas"
            style={{
              flex: "1 1 300px",
              minWidth: 0,
              position: "sticky",
              top: 12,
              maxHeight: "calc(100vh - 24px)",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, color: c.muted }}>
              {ranked.length} areas · ranked by {AREA_METRICS.find((m) => m.value === activeMetric)?.label.toLowerCase()}. Tick the areas to
              show on the picture; click a name to point it out on the picture; rename an area to call it what your team calls it.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setHidden(new Set())} disabled={hidden.size === 0} style={smallButton}>
                Show all
              </button>
              <button type="button" onClick={() => setHidden(new Set(stats.map((s) => s.area.key)))} disabled={hidden.size >= stats.length} style={smallButton}>
                Hide all
              </button>
            </div>
            {ranked.map((s) => (
              <AreaRow
                key={s.area.id}
                value={formatMetric(valueOf(s), activeMetric)}
                ratio={valueOf(s) / maxValue}
                name={nameOf(s)}
                suggested={snapshot.names[s.area.key] ? clean(s.area.name) : null}
                selected={pinned?.kind === "area" && pinned.id === s.area.id}
                visible={!hidden.has(s.area.key)}
                onToggle={() => toggleArea(s.area.key)}
                onSelect={() => focusArea(s.area.id)}
                onRename={(name) => props.onRename(s.area.key, name)}
              />
            ))}
          </aside>
        )}
      </div>

      {hover && !sameTarget(hover, pinned) && (
        <HoverCard x={hover.x} y={hover.y}>
          {pointerY && hasScroll && (
            <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${c.line}` }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#B8461A" }}>{formatMetric(reachAt(scroll, pointerY.pageY), "seen")}</span>{" "}
              <span style={{ color: c.muted }}>of visits scroll down to here</span>
            </div>
          )}
          {cardFor(hover)}
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
        border: `3px ${props.dashed ? "dashed" : "solid"} #2F4BD8`,
        boxShadow: "0 0 0 3px rgba(47,75,216,0.25)",
        pointerEvents: "none",
      }}
    />
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} style={{ width: 18, height: 18, margin: 0, accentColor: "#2F4BD8" }} />
      {props.label}
    </label>
  );
}

function HoverCard(props: { x: number; y: number; children: ReactNode }) {
  const width = 300;
  const left = Math.min(props.x + 16, window.innerWidth - width - 12);
  const top = Math.min(props.y + 16, window.innerHeight - 280);
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
        padding: 14,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {props.children}
    </div>
  );
}

function Stat(props: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: props.accent ? c.accentSoft : c.surfaceAlt, borderRadius: 8, padding: "6px 8px" }}>
      <div style={{ fontSize: 11, color: c.muted }}>{props.label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: props.accent ? c.accent : c.ink }}>{props.value}</div>
    </div>
  );
}

const kicker: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: c.muted };

function AreaCard(props: {
  stat: AreaStat;
  name: string;
  numbers: ReturnType<typeof areaNumbers>;
  snapshot: Snapshot;
  pageVisits: number;
  goal: { label: string; page: Conversion | null } | null;
}) {
  const { stat, numbers } = props;
  const top = stat.elements
    .slice()
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);
  return (
    <>
      <div style={kicker}>Area</div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{props.name}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
        <Stat label="Seen by" value={formatMetric(numbers.seen, "seen")} accent />
        <Stat label="Share of clicks" value={formatMetric(numbers.share, "share")} />
        <Stat label="Clicks / 100 views" value={formatMetric(numbers.per100, "per100")} />
      </div>
      {props.goal && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: c.surfaceAlt }}>
          <div style={{ fontSize: 11, color: c.muted }}>Reached “{props.goal.label}” after a click here</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {formatMetric(numbers.conversion, "conversion")}
            {props.goal.page && props.goal.page.visits > 0 && (
              <span style={{ fontSize: 12, fontWeight: 500, color: c.muted }}> · page average {pctOf(props.goal.page.converted, props.goal.page.visits)}</span>
            )}
          </div>
        </div>
      )}
      <div style={{ marginTop: 8, fontWeight: 600 }}>Most clicked inside</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
        {top.map((m) => (
          <li key={m.index}>
            {props.snapshot.map.elements[m.index].name} — {pctOf(m.visits, props.pageVisits)} of visits
          </li>
        ))}
      </ul>
    </>
  );
}

interface Related {
  inside: number;
  insideCount: number;
  around: { name: string; clicks: number; visits: number; depth: number } | null;
}

function ElementCard(props: {
  m: MatchedElement | null;
  name: string;
  area: string | null;
  seen: number | null;
  pageVisits: number;
  totalClicks: number;
  related: Related;
  goal: { label: string; page: Conversion | null; mine: { visits: number; converted: number } | null } | null;
}) {
  const r = props.related;
  const g = props.goal;
  const { m, seen, pageVisits } = props;
  const seenVisits = seen !== null ? seen * pageVisits : 0;
  return (
    <>
      <div style={kicker}>Element</div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{props.name}</div>
      {props.area && <div style={{ color: c.muted }}>in {props.area}</div>}
      <div style={{ fontSize: 28, fontWeight: 800, color: "#B8461A", marginTop: 4 }}>{m ? pctOf(m.visits, pageVisits) : "0%"}</div>
      <div style={{ color: c.muted }}>{m ? "of visits to this page click it" : "nobody clicked it in this period"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
        <Stat label="Seen by" value={seen === null ? "–" : formatMetric(seen, "seen")} accent />
        <Stat label="Clicked by, of those who saw it" value={m && seenVisits > 0 ? pctOf(Math.min(m.visits, seenVisits), seenVisits) : "0%"} accent />
        <Stat label="Clicks" value={formatInt(m?.clicks ?? 0)} />
        <Stat label="Share of page clicks" value={m ? pctOf(m.clicks, props.totalClicks) : "0%"} />
      </div>
      {r.inside > 0 && (
        <div style={{ marginTop: 8, color: c.muted }}>
          Plus {formatInt(r.inside)} clicks on {r.insideCount === 1 ? "an element" : `${r.insideCount} elements`} inside it.
        </div>
      )}
      {g && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: c.surfaceAlt }}>
          <div style={{ fontSize: 11, color: c.muted }}>Reached “{g.label}” after clicking it</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {g.mine && g.mine.visits > 0 ? pctOf(g.mine.converted, g.mine.visits) : "–"}
            {g.page && g.page.visits > 0 && (
              <span style={{ fontSize: 12, fontWeight: 500, color: c.muted }}> · page average {pctOf(g.page.converted, g.page.visits)}</span>
            )}
          </div>
        </div>
      )}
      {!m && r.around && (
        <div style={{ marginTop: 8, color: c.muted }}>
          It is part of <strong style={{ color: c.ink }}>{r.around.name}</strong>, clicked by {pctOf(r.around.visits, pageVisits)} of visits: Dynatrace
          recorded those clicks on that larger element.
        </div>
      )}
    </>
  );
}

const smallButton: CSSProperties = {
  minHeight: 32,
  padding: "0 10px",
  borderRadius: 8,
  border: `1px solid ${c.line}`,
  background: c.surface,
  color: c.ink,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

function AreaRow(props: {
  value: string;
  ratio: number;
  name: string;
  suggested: string | null;
  selected: boolean;
  visible: boolean;
  onToggle: () => void;
  onSelect: () => void;
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

  const h = chipColors(props.ratio);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 10,
        border: props.selected ? `2px solid ${c.accent}` : `1px solid ${c.line}`,
        background: props.selected ? c.accentSoft : c.surface,
        opacity: props.visible ? 1 : 0.6,
      }}
    >
      <input
        type="checkbox"
        checked={props.visible}
        onChange={props.onToggle}
        aria-label={`Show ${props.name} on the picture`}
        title={props.visible ? "Shown on the picture: untick to hide" : "Hidden: tick to show on the picture"}
        style={{ width: 18, height: 18, margin: 0, flex: "none", accentColor: "#2F4BD8", cursor: "pointer" }}
      />
      <span style={{ minWidth: 58, textAlign: "center", padding: "3px 8px", borderRadius: 999, fontWeight: 800, fontSize: 13, background: h.bg, color: h.fg }}>
        {props.value}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label="Area name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          maxLength={60}
          style={{ flex: 1, minWidth: 0, minHeight: 36, padding: "0 8px", borderRadius: 8, border: `1px solid ${c.accent}`, background: c.surface, color: c.ink, fontSize: 14 }}
        />
      ) : (
        <button
          type="button"
          onClick={props.onSelect}
          style={{ flex: 1, minWidth: 0, textAlign: "left", border: 0, background: "transparent", color: c.ink, cursor: "pointer", padding: 0, minHeight: 36 }}
        >
          <span style={{ display: "block", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.name}</span>
          {props.suggested && <span style={{ display: "block", fontSize: 12, color: c.muted }}>Suggested: {props.suggested}</span>}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          aria-label={`Rename ${props.name}`}
          onClick={() => {
            setDraft(props.name);
            setEditing(true);
          }}
          style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${c.line}`, background: c.surface, color: c.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
    </div>
  );
}
