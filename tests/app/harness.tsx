/**
 * Test harness: renders SnapshotView outside Dynatrace with a snapshot taken
 * by the extension (tests/overlay) and known click and scroll data.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MapMode, SnapshotView } from "../../ui/components/SnapshotView";
import { GLOBAL_CSS } from "../../ui/theme";
import type { Snapshot } from "../../ui/lib/snapshots";

declare global {
  interface Window {
    __data: { snapshot: Snapshot; elements: any[]; scroll: any; pageVisits: number; device: string; cells?: any[]; widths?: any[]; conversions?: any[]; pageConversion?: any };
    renamed: [string, string][];
  }
}

const d = window.__data;
window.renamed = [];
function App() {
  const [mode, setMode] = useState<MapMode>("areas");
  const w = d.snapshot.viewport.w;
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <style>{GLOBAL_CSS}</style>
      <SnapshotView
        snapshot={d.snapshot}
        elements={d.elements}
        scroll={d.scroll}
        pageVisits={d.pageVisits}
        deviceKey={d.device}
        saving={false}
        onRename={(k, n) => window.renamed.push([k, n])}
        mode={mode}
        onMode={setMode}
        heat={mode === "clicks" ? { cells: d.cells ?? [], widths: d.widths ?? [], range: [w - 58, w + 58], loading: false, error: null } : null}
        goal={d.conversions ? { label: "Checkout", page: d.pageConversion, elements: d.conversions, loading: false, error: null } : null}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
