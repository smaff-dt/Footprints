"""The app's page map, rendered outside Dynatrace with a snapshot taken by the
extension (run tests/overlay/e2e.py first) and known clicks and scroll data.

Checks: clicks recorded with different xpath spellings land on the right
elements; areas show only the chosen metric; hovering shows the card;
renaming calls back with the area key."""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "overlay"))
from run import shop  # noqa: E402  (same rows the snapshot was taken with)

snapshot = json.loads((HERE.parent / "overlay" / "snapshot.json").read_text())
elements = [{"xpath": x, "clicks": c, "visits": v, "label": "x"} for x, c, v in shop]
# The same footer link recorded with the other spellings seen in real data:
elements.append({"xpath": ["html", "body", 'div[@id="__next"]', "div2", "a"], "clicks": 40, "visits": 40, "label": "x"})
elements.append({"xpath": ['//*[@id="__next"]', "div", "div", "a"], "clicks": 30, "visits": 30, "label": "x"})
elements.append({"xpath": ["html", "body", "div", "nothing-here"], "clicks": 10, "visits": 10, "label": "x"})
# Click positions, recorded at the snapshot's own width: a cluster on each "Add" and on "Shop now".
rows = []
for e in snapshot["map"]["elements"]:
    b = e["box"]
    if not e["keys"][0].startswith("[") or not ("Add" in e["name"] or "Shop" in e["name"]):
        continue
    for dx in range(-16, 17, 8):
        for dy in range(-8, 9, 8):
            rows.append({"xpath": json.loads(e["keys"][0]), "width": snapshot["viewport"]["w"], "x": b["x"] + b["w"] / 2 + dx, "y": b["y"] + b["h"] / 2 + dy, "clicks": 50 if "Shop" in e["name"] else 10})
conversions = [{"xpath": x, "visits": v, "converted": v // (3 if i % 2 else 8)} for i, (x, c, v) in enumerate(shop)]
data = {
    "snapshot": snapshot,
    "elements": elements,
    "scroll": {"step": 50, "steps": [[900, 20000], [1300, 20000]], "visits": 40000},
    "pageVisits": 40000,
    "device": "desktop",
    "rows": rows,
    "conversions": conversions,
    "pageConversion": {"visits": 40000, "converted": 4000},
}

html = f"""<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="root"></div><script>window.__data = {json.dumps(data)};</script>
<script src="harness.js"></script></body></html>"""
(HERE / "harness.html").write_text(html)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto((HERE / "harness.html").as_uri())
    pg.wait_for_selector("[data-area]")
    if pg.locator("aside").count() == 0:
        pg.click("text=Show areas")
    info = pg.inner_text("main, body").split("\n")
    print("info line:", next(l for l in info if "Snapshot of" in l))
    print("labels on the map (Seen by):", pg.eval_on_selector_all("[data-area] span", "els => els.map(e => e.textContent)"))
    print("metric options:", pg.eval_on_selector_all("select option", "els => els.map(e => e.textContent)"))
    pg.select_option("select", "share")
    print("labels on the map (Share of clicks):", pg.eval_on_selector_all("[data-area] span", "els => els.map(e => e.textContent)"))
    print("areas in the sidebar:", pg.eval_on_selector_all("aside [aria-label^=Rename]", "els => els.map(e => e.getAttribute('aria-label'))"))

    # Hover the hero area and an element
    box = pg.eval_on_selector_all("[data-area]", "els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })")
    x, y, w, h = box[0]
    pg.mouse.move(x + w - 30, y + h - 30)
    pg.wait_for_timeout(150)
    print("hover card (area):", pg.inner_text("[role=tooltip]").replace("\n", " · ")[:160])

    # Point at an element that nobody clicked (anything in the map), then select it
    pg.mouse.move(5, 5)
    target = pg.evaluate("""() => {
      const d = window.__data, m = d.snapshot.map;
      const clicked = new Set();
      const img = document.querySelector('img'); const r = img.getBoundingClientRect();
      // pick the smallest element whose centre is not inside a clicked element's box
      const els = m.elements.map((e, i) => ({e, i})).sort((a, b) => a.e.box.w * a.e.box.h - b.e.box.w * b.e.box.h);
      for (const {e} of els) {
        if (e.box.w < 20 || e.box.h < 12 || e.box.y > 1500) continue;
        return { x: r.left + (e.box.x + e.box.w / 2) * r.width / m.page.w, y: r.top + (e.box.y + e.box.h / 2) * r.height / m.page.h, name: e.name };
      }
    }""")
    pg.mouse.move(target["x"], target["y"])
    pg.wait_for_timeout(150)
    print("hover card (element):", pg.inner_text("[role=tooltip]").replace("\n", " · ")[:200])
    pg.mouse.click(target["x"], target["y"])
    pg.wait_for_timeout(150)
    print("selected in sidebar:", pg.inner_text("[aria-label=Selected]").replace("\n", " · ")[:200])
    pg.screenshot(path=str(HERE / "selected.png"))
    print("sidebar still open, card on the picture:", pg.locator("aside").count() == 1, pg.locator("[aria-label=Selected]").evaluate("e => e.parentElement.querySelector('img') !== null"))
    pg.click("[aria-label=Selected] [aria-label=Close]")
    print("selection cleared:", pg.locator("[aria-label=Selected]").count() == 0)

    # Hide an area, show it again; select an area from the sidebar and deselect it
    n = lambda: pg.locator("[data-area]").count()
    before = n()
    pg.click("aside input[type=checkbox] >> nth=0")
    after = n()
    pg.click("text=Show all")
    print("areas on the picture: shown", before, "· one hidden", after, "· show all", n())
    pg.click("aside button:has-text('Hot products') >> nth=0")
    sel = pg.locator("[aria-label=Selected]").count()
    pg.click("aside button:has-text('Hot products') >> nth=-1")
    print("area selected then deselected from the sidebar:", sel == 1, pg.locator("[aria-label=Selected]").count() == 0)

    # Conversion metric, heatmaps
    print("metric options with a goal:", pg.eval_on_selector_all("select option", "els => els.map(e => e.textContent)"))
    pg.select_option("select", "conversion")
    print("labels (conversion):", pg.eval_on_selector_all("[data-area] span", "els => els.map(e => e.textContent)"))
    pg.mouse.move(target["x"], target["y"]); pg.wait_for_timeout(150)
    print("element card with goal:", pg.inner_text("[role=tooltip]").replace("\n", " · ")[-120:])
    pg.click("text=Click heatmap"); pg.wait_for_timeout(300)
    print("click heatmap: canvas drawn:", pg.evaluate("(() => { const c = document.querySelector('canvas'); if (!c) return false; const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for (let i=3;i<d.length;i+=4) if (d[i]>0) n++; return n; })()"), "· areas hidden:", pg.locator("[data-area]").count() == 0)
    print("heatmap line:", next(l for l in pg.inner_text("body").split("\n") if "clicks placed" in l))
    pg.screenshot(path=str(HERE / "click-heatmap.png"), full_page=True)
    pg.click("text=Scroll heatmap"); pg.wait_for_timeout(200)
    pg.mouse.move(target["x"], target["y"] + 300); pg.wait_for_timeout(150)
    print("scroll heatmap hover:", pg.inner_text("[role=tooltip]").replace("\n", " · ")[:80])
    pg.screenshot(path=str(HERE / "scroll-heatmap.png"), full_page=True)
    pg.click("text=Areas"); pg.wait_for_timeout(100)

    # Rename the first area
    pg.click("aside [aria-label^=Rename] >> nth=0")
    pg.keyboard.press("Control+A")
    pg.keyboard.type("Product grid")
    pg.keyboard.press("Enter")
    print("rename callback:", pg.evaluate("window.renamed"))
    pg.screenshot(path=str(HERE / "snapshot-view.png"), full_page=True)
    print("page errors:", errors or "none")
    b.close()
