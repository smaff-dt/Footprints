/**
 * Ranked list of the page's sections (or elements) with a bar per row,
 * plus a detail panel that explains the selected one in a sentence.
 */
import { Section } from "../hooks/data";
import { formatAvg, formatInt, formatPct } from "../lib/format";
import { c } from "../theme";

export type RankBy = "rate" | "clicks" | "visits";

export const RANK_LABELS: Record<RankBy, string> = {
  rate: "Share of visits that click",
  clicks: "Number of clicks",
  visits: "Visits that click",
};

export interface RankedSection extends Section {
  rate: number;
  share: number;
}

export function rankSections(sections: Section[], pageVisits: number, rankBy: RankBy): RankedSection[] {
  const totalClicks = sections.reduce((sum, s) => sum + s.clicks, 0) || 1;
  return sections
    .map((s) => ({ ...s, rate: pageVisits > 0 ? s.visits / pageVisits : 0, share: s.clicks / totalClicks }))
    .sort((a, b) => metric(b, rankBy) - metric(a, rankBy));
}

function metric(s: RankedSection, rankBy: RankBy): number {
  return rankBy === "clicks" ? s.clicks : rankBy === "visits" ? s.visits : s.rate;
}

function display(s: RankedSection, rankBy: RankBy): string {
  return rankBy === "clicks" ? formatInt(s.clicks) : rankBy === "visits" ? formatInt(s.visits) : formatPct(s.rate);
}

export function SectionRanking(props: {
  sections: RankedSection[];
  rankBy: RankBy;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const max = Math.max(...props.sections.map((s) => metric(s, props.rankBy)), 0) || 1;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {props.sections.map((s, i) => {
        const selected = s.key === props.selectedKey;
        const ratio = metric(s, props.rankBy) / max;
        return (
          <li key={s.key}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => props.onSelect(s.key)}
              style={{
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                borderRadius: 10,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                border: selected ? `2px solid ${c.accent}` : `1px solid ${c.line}`,
                background: selected ? c.accentSoft : c.surface,
                color: c.ink,
              }}
            >
              <span style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%" }}>
                <span style={{ display: "flex", gap: 10, minWidth: 0 }}>
                  <span style={{ color: c.muted, fontVariantNumeric: "tabular-nums", minWidth: 22 }}>{i + 1}</span>
                  <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.label}
                  </span>
                </span>
                <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                  {display(s, props.rankBy)}
                </span>
              </span>
              <span aria-hidden="true" style={{ display: "block", height: 8, borderRadius: 4, background: c.surfaceAlt }}>
                <span
                  style={{
                    display: "block",
                    height: 8,
                    borderRadius: 4,
                    width: `${Math.max(3, Math.round(ratio * 100))}%`,
                    background: `linear-gradient(90deg, ${c.heatMid}, ${c.heatHigh})`,
                  }}
                />
              </span>
              <span style={{ fontSize: 13, color: c.muted }}>
                {formatInt(s.visits)} visits · {formatInt(s.clicks)} clicks
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function SectionDetail(props: { section: RankedSection; pageVisits: number; isElement: boolean }) {
  const s = props.section;
  const perVisit = s.visits > 0 ? s.clicks / s.visits : 0;
  const noun = props.isElement ? "element" : "section";
  return (
    <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Selected {noun}
      </div>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, overflowWrap: "anywhere" }}>{s.label}</h2>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.02em", color: c.heatHigh }}>
          {formatPct(s.rate)}
        </span>
        <span style={{ color: c.muted }}>of visits to this page click here</span>
      </div>
      <p style={{ margin: 0 }}>
        {formatInt(s.visits)} of {formatInt(props.pageVisits)} visits clicked this {noun}, on average{" "}
        {formatAvg(perVisit)} times each. It receives {formatPct(s.share)} of all clicks on the page.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        <Stat label="Visits" value={formatInt(s.visits)} />
        <Stat label="Clicks" value={formatInt(s.clicks)} />
        <Stat label="Clicks per visit" value={formatAvg(perVisit)} />
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 10, background: c.surfaceAlt }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: c.muted }}>{props.label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}
