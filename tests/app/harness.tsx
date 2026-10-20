/**
 * Test harness: renders SnapshotView outside Dynatrace with a snapshot taken
 * by the extension (tests/overlay) and known click and scroll data.
 */
import { createRoot } from "react-dom/client";
import { SnapshotView } from "../../ui/components/SnapshotView";
import { GLOBAL_CSS } from "../../ui/theme";
import type { Snapshot } from "../../ui/lib/snapshots";

declare global {
  interface Window {
    __data: { snapshot: Snapshot; elements: any[]; scroll: any; pageVisits: number; device: string };
    renamed: [string, string][];
  }
}

const d = window.__data;
window.renamed = [];
function App() {
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
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
