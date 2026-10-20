/**
 * A saved snapshot with its numbers: the picture of the page, each area
 * colored by the chosen metric (only the number is drawn on the page), a card
 * that follows the pointer with the details, and a sidebar to rename areas.
 * Numbers are recomputed from the current filters; the snapshot only stores
 * the picture and the map.
 */
import { CSSProperties, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { PageElement, ScrollDepth } from "../hooks/data";
import { formatInt } from "../lib/format";
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
  MatchedElement,
  metricValue,
  startingDetail,
} from "../lib/snapshotMath";
import type { Snapshot } from "../lib/snapshots";
import { c } from "../theme";

type Hover =
  | { kind: "area"; stat: AreaStat; x: number; y: number }
  | { kind: "element"; el: MatchedElement; x: number; y: number }
  | null;

const HEAT = ["#F6D9A8", "#EE9B4D", "#B8461A"];

function heat(ratio: number): { bg: string; fg: string } {
  if (ratio >= 0.66) return { bg: HEAT[2], fg: "#FFFFFF" };
  if (ratio >= 0.33) return { bg: HEAT[1], fg: "#16191F" };
  return { bg: HEAT[0], fg: "#16191F" };
}

function pctOf(n: number, total: number): string {
  if (!total) return "–";
  const v = Math.min(100, (100 * n) / total);
  return v > 0 && v < 0.1 ? "<0.1%" : `${v.toFixed(v >= 10 ? 0 : 1)}%`;
}

export function SnapshotView(props: {
  snapshot: Snapshot;
  elements: PageElement[];
  scroll: ScrollDepth | null;
  pageVisits: number;
  deviceKey: string;
  saving: boolean;
  onRename: (areaKey: string, name: string) => void;
}) {
  const { snapshot, scroll, pageVisits } = props;
  const map = snapshot.map;
  const matching = useMemo(() => matchClicks(map, props.elements), [map, props.elements]);
  const hasScroll = !!(scroll && scroll.visits);

  const [metric, setMetric] = useState<AreaMetric>("seen");
  const [detail, setDetail] = useState<number>(() => startingDetail(map, matching));
  const [showDots, setShowDots] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const [hover, setHover] = useState<Hover>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // A new snapshot or new data: start again from a sensible detail level.
  useEffect(() => setDetail(startingDetail(map, matching)), [map, matching]);
  const activeMetric: AreaMetric = !hasScroll && metric !== "share" ? "share" : metric;

  const stats = useMemo(() => areasAt(map, matching, detail), [map, matching, detail]);
  const numbers = useMemo(
    () => new Map(stats.map((s) => [s.area.id, areaNumbers(s, matching.totalClicks, pageVisits, scroll)])),
    [stats, matching.totalClicks, pageVisits, scroll],
  );
  const valueOf = (s: AreaStat) => metricValue(numbers.get(s.area.id)!, activeMetric) ?? 0;
  const maxValue = Math.max(1e-9, ...stats.map(valueOf));
  const ranked = stats.slice().sort((a, b) => valueOf(b) - valueOf(a));
  const nameOf = (s: AreaStat) => snapshot.names[s.area.key] || s.area.name;

  const W = map.page.w;
  const H = map.page.h;
  const at = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({
    left: `${(100 * b.x) / W}%`,
    top: `${(100 * b.y) / H}%`,
    width: `${(100 * b.w) / W}%`,
    height: `${(100 * b.h) / H}%`,
  });

  const matched = Array.from(matching.byElement.values());
  const maxClicks = Math.max(1, ...matched.map((m) => m.clicks));
  const lines = hasScroll
    ? [0.75, 0.5, 0.25]
        .map((share) => ({ share, d: depthReachedBy(scroll, share) }))
        .filter((l): l is { share: number; d: number } => l.d !== null && l.d > 0 && l.d < H)
    : [];

  const coverage = matching.totalClicks ? matching.matchedClicks / matching.totalClicks : 1;
  const notes: string[] = [];
  if (matching.totalClicks && coverage < 0.8) {
    notes.push(
      `Only ${pctOf(matching.matchedClicks, matching.totalClicks)} of this period's clicks are on elements of this snapshot. The page may have changed since it was taken: consider a new snapshot.`,
    );
  }
  if (props.deviceKey !== "all" && snapshot.device && snapshot.device !== "all" && props.deviceKey !== snapshot.device) {
    notes.push(`This snapshot shows the ${snapshot.device} page, but the data is for ${props.deviceKey}. Choose ${snapshot.device} in the filters.`);
  } else if (props.deviceKey === "all" && hasScroll) {
    notes.push("“Seen by” mixes desktop and mobile visits, whose pages have different lengths. Choose one device for exact numbers.");
  }
  if (snapshot.truncated) notes.push("The page is very long: the snapshot stops at 16,000 pixels.");

  function focusArea(id: string) {
    setSelected(id);
    const node = canvasRef.current?.querySelector<HTMLElement>(`[data-area="${CSS.escape(id)}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const taken = new Date(snapshot.capturedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Top bar: what to show */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px" }}>
        <div role="group" aria-label="Metric" style={{ display: "flex", flexWrap: "wrap", padding: 3, gap: 3, borderRadius: 12, background: c.surfaceAlt }}>
          {AREA_METRICS.map((m) => {
            const disabled = m.needsScroll && !hasScroll;
            const on = activeMetric === m.value;
            return (
              <button
                key={m.value}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                title={disabled ? "No scroll data for this page" : undefined}
                onClick={() => setMetric(m.value)}
                style={{
                  minHeight: 38,
                  padding: "0 14px",
                  borderRadius: 9,
                  border: 0,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.45 : 1,
                  background: on ? c.surface : "transparent",
                  color: on ? c.ink : c.muted,
                  boxShadow: on ? "0 1px 3px rgba(22,25,31,0.14)" : "none",
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
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
        {hasScroll && <Toggle label="Scroll lines" checked={showLines} onChange={setShowLines} />}
        <button
          type="button"
          onClick={() => setSidebar((s) => !s)}
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
        Snapshot taken {Number.isNaN(taken.getTime()) ? snapshot.capturedAt : taken.toLocaleString()} · {snapshot.device} ·{" "}
        {pctOf(matching.matchedClicks, matching.totalClicks)} of this period's clicks are on it
        {props.saving ? " · saving names…" : ""}
      </div>
      {notes.map((n) => (
        <div key={n} role="note" style={{ padding: "10px 12px", borderRadius: 10, background: c.warnSoft, color: c.warnInk, fontSize: 14 }}>
          {n}
        </div>
      ))}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        {/* The page */}
        <div
          ref={canvasRef}
          onMouseLeave={() => setHover(null)}
          style={{
            flex: "999 1 560px",
            minWidth: 0,
            position: "relative",
            border: `1px solid ${c.lineStrong}`,
            borderRadius: 10,
            overflow: "hidden",
            background: "#FFFFFF",
          }}
        >
          <img src={snapshot.image.dataUrl} alt={`Snapshot of ${snapshot.title || snapshot.url}`} style={{ display: "block", width: "100%", height: "auto" }} />
          {stats
            .slice()
            .sort((a, b) => b.area.box.w * b.area.box.h - a.area.box.w * a.area.box.h)
            .map((s) => {
              const r = valueOf(s) / maxValue;
              const h = heat(r);
              const isSel = selected === s.area.id;
              return (
                <div
                  key={s.area.id}
                  data-area={s.area.id}
                  onMouseMove={(e) => setHover({ kind: "area", stat: s, x: e.clientX, y: e.clientY })}
                  onClick={() => setSelected(isSel ? null : s.area.id)}
                  style={{
                    position: "absolute",
                    ...at(s.area.box),
                    boxSizing: "border-box",
                    borderRadius: 6,
                    border: isSel ? "3px solid #2F4BD8" : "2px solid rgba(184,70,26,0.75)",
                    background: `rgba(232,116,46,${(0.1 + 0.4 * r).toFixed(2)})`,
                    cursor: "pointer",
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
                      pointerEvents: "none",
                    }}
                  >
                    {formatMetric(metricValue(numbers.get(s.area.id)!, activeMetric), activeMetric)}
                  </span>
                </div>
              );
            })}
          {showLines &&
            lines.map((l) => (
              <div
                key={l.share}
                style={{ position: "absolute", left: 0, right: 0, top: `${(100 * l.d) / H}%`, borderTop: "2px dashed rgba(47,75,216,0.85)", pointerEvents: "none" }}
              >
                <span style={{ position: "absolute", right: 8, top: -20, padding: "1px 8px", borderRadius: "6px 6px 0 0", background: "#2F4BD8", color: "#FFFFFF", fontSize: 11, fontWeight: 700 }}>
                  {Math.round(l.share * 100)}% of visits see down to here
                </span>
              </div>
            ))}
          {showDots &&
            matched.map((m) => {
              const e = map.elements[m.index];
              const size = 8 + Math.round(14 * Math.sqrt(m.clicks / maxClicks));
              return (
                <div
                  key={m.index}
                  onMouseMove={(ev) => {
                    ev.stopPropagation();
                    setHover({ kind: "element", el: m, x: ev.clientX, y: ev.clientY });
                  }}
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
                  }}
                />
              );
            })}
        </div>

        {/* Sidebar: areas, ranked by the chosen metric, with renaming */}
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
              {ranked.length} areas · ranked by {AREA_METRICS.find((m) => m.value === activeMetric)?.label.toLowerCase()}. Rename an area to
              call it what your team calls it.
            </div>
            {ranked.map((s) => (
              <AreaRow
                key={s.area.id}
                value={formatMetric(valueOf(s), activeMetric)}
                ratio={valueOf(s) / maxValue}
                name={nameOf(s)}
                suggested={snapshot.names[s.area.key] ? s.area.name : null}
                selected={selected === s.area.id}
                onSelect={() => focusArea(s.area.id)}
                onRename={(name) => props.onRename(s.area.key, name)}
              />
            ))}
          </aside>
        )}
      </div>

      {hover && (
        <HoverCard x={hover.x} y={hover.y}>
          {hover.kind === "area" ? (
            <AreaCard stat={hover.stat} name={nameOf(hover.stat)} numbers={numbers.get(hover.stat.area.id)!} snapshot={snapshot} pageVisits={pageVisits} />
          ) : (
            <ElementCard
              m={hover.el}
              name={map.elements[hover.el.index].name}
              seen={exposureOf(scroll, map.elements[hover.el.index].box)}
              pageVisits={pageVisits}
              totalClicks={matching.totalClicks}
            />
          )}
        </HoverCard>
      )}
    </div>
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
  const top = Math.min(props.y + 16, window.innerHeight - 260);
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

function AreaCard(props: { stat: AreaStat; name: string; numbers: ReturnType<typeof areaNumbers>; snapshot: Snapshot; pageVisits: number }) {
  const { stat, numbers } = props;
  const top = stat.elements
    .slice()
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: c.muted }}>Area</div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{props.name}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
        <Stat label="Seen by" value={formatMetric(numbers.seen, "seen")} accent />
        <Stat label="Share of clicks" value={formatMetric(numbers.share, "share")} />
        <Stat label="Clicks / 100 views" value={formatMetric(numbers.per100, "per100")} />
      </div>
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

function ElementCard(props: { m: MatchedElement; name: string; seen: number | null; pageVisits: number; totalClicks: number }) {
  const { m, seen, pageVisits } = props;
  const seenVisits = seen !== null ? seen * pageVisits : 0;
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: c.muted }}>Element</div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{props.name}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#B8461A", marginTop: 4 }}>{pctOf(m.visits, pageVisits)}</div>
      <div style={{ color: c.muted }}>of visits to this page click it</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
        <Stat label="Seen by" value={seen === null ? "–" : formatMetric(seen, "seen")} accent />
        <Stat label="Clicked by, of those who saw it" value={seenVisits > 0 ? pctOf(Math.min(m.visits, seenVisits), seenVisits) : "–"} accent />
        <Stat label="Clicks" value={formatInt(m.clicks)} />
        <Stat label="Share of page clicks" value={pctOf(m.clicks, props.totalClicks)} />
      </div>
    </>
  );
}

function AreaRow(props: {
  value: string;
  ratio: number;
  name: string;
  suggested: string | null;
  selected: boolean;
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

  const h = heat(props.ratio);
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
      }}
    >
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
