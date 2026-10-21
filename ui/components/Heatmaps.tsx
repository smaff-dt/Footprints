/**
 * Heatmap layers drawn over a snapshot: where visitors click, and how far
 * down the page they get. Both use the same cold-to-hot color scale.
 */
import { useEffect, useMemo, useRef } from "react";
import type { HeatCell, ScrollDepth } from "../hooks/data";
import { HEAT_CELL } from "../dql/queries";
import { reachAt } from "../lib/snapshotMath";
import { c } from "../theme";

const STOPS: [number, [number, number, number]][] = [
  [0, [43, 131, 186]],
  [0.25, [102, 194, 165]],
  [0.5, [230, 230, 120]],
  [0.75, [253, 174, 97]],
  [1, [215, 25, 28]],
];

/** Cold (blue, 0) to hot (red, 1). */
export function heatRgb(t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (v <= p1) {
      const k = (v - p0) / (p1 - p0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + k * (c1[j] - c0[j]))) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const SCALE = 1 / 3; // canvas pixels per page pixel
const RADIUS = 26; // page pixels

/** Click heatmap: a glow around every place clicked, hotter where clicks pile up. */
export function ClickHeatLayer(props: { cells: HeatCell[]; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const cw = Math.max(1, Math.round(props.width * SCALE));
    const ch = Math.max(1, Math.round(props.height * SCALE));
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    const max = Math.max(1, ...props.cells.map((p) => p.clicks));
    const r = RADIUS * SCALE;
    // 1. Intensity: overlapping soft circles, stronger for busier cells (log scale so one hot spot does not hide the rest).
    for (const p of props.cells) {
      const x = (p.x + HEAT_CELL / 2) * SCALE;
      const y = (p.y + HEAT_CELL / 2) * SCALE;
      if (x < -r || y < -r || x > cw + r || y > ch + r) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.05 + 0.5 * (Math.log1p(p.clicks) / Math.log1p(max));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
    // 2. Color: intensity → cold-to-hot scale.
    const img = ctx.getImageData(0, 0, cw, ch);
    const d = img.data;
    const palette = Array.from({ length: 256 }, (_, i) => heatRgb(i / 255));
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      const [rr, gg, bb] = palette[a];
      d[i] = rr;
      d[i + 1] = gg;
      d[i + 2] = bb;
      d[i + 3] = Math.min(220, 40 + a);
    }
    ctx.putImageData(img, 0, 0);
  }, [props.cells, props.width, props.height]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", background: "rgba(22,25,31,0.25)" }}
    />
  );
}

/** Scroll heatmap: the page colored by the share of visits that get down to each height. */
export function ScrollHeatLayer(props: { scroll: ScrollDepth; height: number }) {
  const background = useMemo(() => {
    const stops: string[] = [];
    const n = 100;
    for (let i = 0; i <= n; i++) {
      const y = (props.height * i) / n;
      const share = reachAt(props.scroll, y) ?? 0;
      const [r, g, b] = heatRgb(share);
      stops.push(`rgba(${r},${g},${b},0.5) ${i}%`);
    }
    return `linear-gradient(to bottom, ${stops.join(", ")})`;
  }, [props.scroll, props.height]);
  return <div aria-hidden="true" style={{ position: "absolute", inset: 0, background, pointerEvents: "none" }} />;
}

export function HeatLegend(props: { low: string; high: string }) {
  const gradient = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => `rgb(${heatRgb(t).join(",")})`).join(", ")})`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: c.muted }}>
      {props.low}
      <span aria-hidden="true" style={{ width: 120, height: 10, borderRadius: 5, background: gradient }} />
      {props.high}
    </div>
  );
}
