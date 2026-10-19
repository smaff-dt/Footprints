/**
 * Design tokens. Colors are CSS custom properties so the app follows the
 * platform's light or dark appearance.
 */
export const c = {
  ground: "var(--fp-ground)",
  surface: "var(--fp-surface)",
  surfaceAlt: "var(--fp-surface-alt)",
  ink: "var(--fp-ink)",
  muted: "var(--fp-muted)",
  line: "var(--fp-line)",
  lineStrong: "var(--fp-line-strong)",
  accent: "var(--fp-accent)",
  accentSoft: "var(--fp-accent-soft)",
  heatLow: "var(--fp-heat-low)",
  heatMid: "var(--fp-heat-mid)",
  heatHigh: "var(--fp-heat-high)",
  warnSoft: "var(--fp-warn-soft)",
  warnInk: "var(--fp-warn-ink)",
} as const;

export const font = "'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif";

export const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap');
:root {
  --fp-ground: #F6F7F9;
  --fp-surface: #FFFFFF;
  --fp-surface-alt: #F1F3F6;
  --fp-ink: #16191F;
  --fp-muted: #5B6270;
  --fp-line: #E2E5EA;
  --fp-line-strong: #CDD2DA;
  --fp-accent: #2F4BD8;
  --fp-accent-soft: #EEF1FD;
  --fp-heat-low: #F6D9A8;
  --fp-heat-mid: #EE9B4D;
  --fp-heat-high: #B8461A;
  --fp-warn-soft: #FBEFE6;
  --fp-warn-ink: #6B2A0E;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fp-ground: #121418;
    --fp-surface: #1B1E24;
    --fp-surface-alt: #23272F;
    --fp-ink: #ECEEF2;
    --fp-muted: #A3AAB6;
    --fp-line: #2E333C;
    --fp-line-strong: #3C424D;
    --fp-accent: #8EA2FF;
    --fp-accent-soft: #252C4A;
    --fp-heat-low: #6B4A22;
    --fp-heat-mid: #C87633;
    --fp-heat-high: #F2A65E;
    --fp-warn-soft: #3A2418;
    --fp-warn-ink: #F6C9A9;
  }
}
html, body { margin: 0; background: var(--fp-ground); }
body { color: var(--fp-ink); font-family: ${font}; font-size: 15px; line-height: 1.45; }
* { box-sizing: border-box; }
button, select, input { font-family: inherit; font-size: inherit; color: inherit; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 3px solid var(--fp-accent); outline-offset: 2px; }
@keyframes fp-pulse { 0%, 100% { opacity: .45 } 50% { opacity: .9 } }
`;
