/**
 * Colors and type come from Strato, the Dynatrace design system, so the app
 * looks like the rest of the platform and follows its light or dark theme.
 * Only the zone and heatmap colors are Footprints' own.
 */
import { Borders, Colors, Typography } from "@dynatrace/strato-design-tokens";

export const c = {
  ground: Colors.Background.Base.Default,
  surface: Colors.Background.Surface.Default,
  surfaceAlt: Colors.Background.Container.Neutral.Default,
  ink: Colors.Text.Neutral.Default,
  muted: Colors.Text.Neutral.Subdued,
  line: Colors.Border.Neutral.Default,
  lineStrong: Colors.Border.Neutral.Subdued,
  accent: Colors.Text.Primary.Default,
  accentSoft: Colors.Background.Container.Primary.Default,
  accentStrong: Colors.Background.Container.Primary.Accent,
  heatLow: "#F6D9A8",
  heatMid: "#EE9B4D",
  heatHigh: "#B8461A",
  warnSoft: Colors.Background.Container.Warning.Default,
  warnInk: Colors.Text.Warning.Default,
  criticalInk: Colors.Text.Critical.Default,
} as const;

export const radius = Borders.Radius.Container.Default;

export const font = Typography.Text.Base.Default.Family;

export const GLOBAL_CSS = `
html, body { margin: 0; background: ${c.ground}; }
body { color: ${c.ink}; font-family: ${font}; font-size: 14px; line-height: 1.43; }
* { box-sizing: border-box; }
button, select, input { font-family: inherit; font-size: inherit; color: inherit; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid ${Colors.Border.Primary.Accent}; outline-offset: 2px; }
.fp-card { transition: border-color .12s, box-shadow .12s; }
.fp-card:hover { border-color: ${Colors.Border.Primary.Accent} !important; box-shadow: 0 2px 10px rgba(11,86,229,0.12); }
@keyframes fp-pulse { 0%, 100% { opacity: .45 } 50% { opacity: .9 } }
`;
