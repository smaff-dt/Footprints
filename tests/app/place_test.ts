/**
 * Clicks recorded at other window widths land on the right element of an
 * automatic snapshot (tests/overlay/auto_test.py makes auto-desktop.json):
 * at 1440 px the 5th "Add" button is in the first row (5 columns); in the
 * 1280 px snapshot it is in the second row (4 columns).
 */
import { readFileSync } from "fs";
import { layoutsOf, placeClicks } from "../../ui/lib/snapshotMath";

const snap = JSON.parse(readFileSync(process.argv[2] || "tests/overlay/auto-desktop.json", "utf8"));
const map = snap.map;
const adds = map.elements.map((e: any, i: number) => [e, i]).filter(([e]: any) => e.name.startsWith("Add"));
const [fifth, index] = adds[4];
const xpath = JSON.parse(fifth.keys[0]);
const at1440 = snap.layouts.find((l: any) => l.width === 1440).boxes[String(index)];
const rows = [
  // a click on the right edge of the button, seen at 1440 px
  { xpath, width: 1440, x: at1440.x + at1440.w - 6, y: at1440.y + 6, clicks: 10 },
  // the same button at 1600 px, a width that was not measured
  { xpath, width: 1600, x: 1200, y: 437, clicks: 4 },
  { xpath, width: 1600, x: 1230, y: 445, clicks: 4 },
  // an element that is not on the snapshot
  { xpath: ["html", "body", "nope"], width: 1440, x: 5, y: 5, clicks: 3 },
];
const placed = placeClicks(map, layoutsOf(snap), rows, 8);
console.log("snapshot box of the 5th Add:", fifth.box, "| at 1440 px it was at", at1440);
console.log("placed cells (centre):", placed.cells.map((c) => [c.x + 4, c.y + 4, c.clicks]));
console.log("exact", placed.exact, "approx", placed.approx, "unplaced", placed.unplaced);
const first = placed.cells.find((c) => c.clicks === 10)!;
const inside = (c: any) => c.x + 4 >= fifth.box.x - 4 && c.x + 4 <= fifth.box.x + fifth.box.w + 4 && c.y + 4 >= fifth.box.y - 4 && c.y + 4 <= fifth.box.y + fifth.box.h + 4;
console.log("1440 px click lands on the button in the snapshot, near its right edge:", inside(first) && first.x + 4 > fifth.box.x + fifth.box.w / 2);
console.log("all placed clicks are on the button:", placed.cells.every(inside));
