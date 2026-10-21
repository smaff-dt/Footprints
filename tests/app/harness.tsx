/**
 * Test harness: renders SnapshotView outside Dynatrace with a snapshot taken
 * by the extension (tests/overlay) and known click, scroll and conversion data.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MapMode, SnapshotView } from "../../ui/components/SnapshotView";
import type { Snapshot } from "../../ui/lib/snapshots";
import { GLOBAL_CSS } from "../../ui/theme";

declare global {
  interface Window {
    __data: { snapshot: Snapshot; elements: any[]; scroll: any; pageVisits: number; rows?: any[]; conversions?: any[]; pageConversion?: any };
    zoning: { zones: string[]; names: Record<string, string> }[];
    counted: string[][];
  }
}

const d = window.__data;
window.zoning = [];
window.counted = [];
function App() {
  const [mode, setMode] = useState<MapMode>("zones");
  const [zones, setZones] = useState<string[]>(d.snapshot.zoning?.zones ?? []);
  const [names, setNames] = useState<Record<string, string>>(d.snapshot.names ?? {});
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <style>{GLOBAL_CSS}</style>
      <SnapshotView
        snapshot={d.snapshot}
        elements={d.elements}
        scroll={d.scroll}
        pageVisits={d.pageVisits}
        periodLabel="Last 7 days"
        saving={false}
        zones={zones}
        names={names}
        onZoning={(z, n) => {
          setZones(z);
          setNames(n);
          window.zoning.push({ zones: z, names: n });
        }}
        countZone={async (sections) => {
          window.counted.push(sections);
          await new Promise((r) => setTimeout(r, 50));
          return { visits: 1234, converted: d.conversions ? 300 : null };
        }}
        countKey="k"
        mode={mode}
        onMode={setMode}
        heat={mode === "clicks" ? { rows: d.rows ?? [], loading: false, error: null } : null}
        goal={d.conversions ? { label: "Checkout", page: d.pageConversion, elements: d.conversions, loading: false, error: null } : null}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
