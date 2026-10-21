"""The page map, rendered outside Dynatrace with a snapshot taken by the
extension (run tests/overlay/e2e.py first) and known data.

Zones: the page opens with no zone; pointing outlines a block; a click turns
it on (it shows the metric and its card, with the blocks around it), another
click turns it off; a larger block can be picked from the card; zones are
renamed in the zone list; Suggest turns on the most clicked zones. Heatmaps
cannot be clicked. The table lists the clicked elements."""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "overlay"))
from run import shop  # noqa: E402  (same rows the snapshot was taken with)

snapshot = json.loads((HERE.parent / "overlay" / "snapshot.json").read_text())
elements = [{"xpath": x, "raw": json.dumps(x), "clicks": c, "visits": v, "label": "x"} for x, c, v in shop]
elements.append({"xpath": ["html", "body", 'div[@id="__next"]', "div2", "a"], "raw": "x1", "clicks": 40, "visits": 40, "label": "x"})
rows = []
for e in snapshot["map"]["elements"]:
    b = e["box"]
    if e["keys"][0].startswith("[") and ("Add" in e["name"] or "Shop" in e["name"]):
        rows.append({"xpath": json.loads(e["keys"][0]), "width": snapshot["viewport"]["w"], "x": b["x"] + b["w"] / 2, "y": b["y"] + b["h"] / 2, "clicks": 20})
conversions = [{"xpath": x, "visits": v, "converted": v // (3 if i % 2 else 8)} for i, (x, c, v) in enumerate(shop)]
data = {
    "snapshot": snapshot, "elements": elements,
    "scroll": {"step": 50, "steps": [[900, 20000], [1300, 20000]], "visits": 40000},
    "pageVisits": 40000, "rows": rows, "conversions": conversions, "pageConversion": {"visits": 40000, "converted": 4000},
}
(HERE / "harness.html").write_text(f"""<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="root"></div><script>window.__data = {json.dumps(data)};</script>
<script src="harness.js"></script></body></html>""")

def box_of(pg, name):
    """Screen position of the map element whose name starts with `name`."""
    return pg.evaluate("""(name) => {
      const m = window.__data.snapshot.map, img = document.querySelector('img').getBoundingClientRect();
      const e = m.elements.find(e => e.name.startsWith(name));
      const k = img.width / m.page.w;
      return { x: img.left + (e.box.x + e.box.w / 2) * k, y: img.top + (e.box.y + e.box.h / 2) * k, name: e.name };
    }""", name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto((HERE / "harness.html").as_uri())
    pg.wait_for_selector("img")
    print("1. opens with no zone:", pg.locator("[data-zone]").count() == 0)
    print("   chips:", pg.locator("span[title], span").filter(has_text="visits").all_inner_texts()[:3])

    t = box_of(pg, "Add")
    pg.mouse.move(t["x"], t["y"]); pg.wait_for_timeout(100)
    print("2. pointing outlines a block:", pg.inner_text("[role=tooltip]").replace("\n", " · "))
    pg.mouse.click(t["x"], t["y"]); pg.wait_for_timeout(200)
    print("3. click turns it on:", pg.locator("[data-zone]").count(), "zone | label:", pg.locator("[data-zone] button").first.inner_text())
    card = pg.inner_text("[aria-label='Selected zone']").replace("\n", " · ")
    print("   card:", card[:260])
    print("   exact visits asked for:", window_counted := pg.evaluate("window.counted.length"))
    chain = pg.locator("[aria-label='Selected zone'] button").all_inner_texts()
    print("   blocks around it:", [c.strip("▪└ \n") for c in chain if c and c not in ("✕", "Turn this zone off")])
    # pick a larger block from the card
    pg.locator("[aria-label='Selected zone'] button:has-text('Product')").first.click(); pg.wait_for_timeout(200)
    print("4. larger block picked:", pg.inner_text("[aria-label='Selected zone'] div div").split("\n")[:2], "| zones on:", pg.locator("[data-zone]").count())
    # second click on the same block turns it off
    t2 = box_of(pg, "Product 1")
    pg.mouse.click(t2["x"] + 60, t2["y"] + 60); pg.wait_for_timeout(200)
    print("5. click again turns it off:", pg.locator("[data-zone]").count() == 0)

    pg.click("text=Suggest zones"); pg.wait_for_timeout(300)
    print("6. suggested:", pg.inner_text("[role=status]")[:200], "| zones on:", pg.locator("[data-zone]").count())
    pg.select_option("select", "conversion"); pg.wait_for_timeout(300)
    print("   conversion labels:", pg.locator("[data-zone] button").all_inner_texts())
    pg.click("text=Zone list")
    pg.click("aside [aria-label^=Rename] >> nth=0")
    pg.keyboard.press("Control+A"); pg.keyboard.type("Product grid"); pg.keyboard.press("Enter"); pg.wait_for_timeout(100)
    print("7. renamed; saved zoning:", pg.evaluate("window.zoning[window.zoning.length - 1]"))
    pg.screenshot(path=str(HERE / "zones.png"), full_page=True)

    pg.click("[role=radio]:has-text('Click heatmap')"); pg.wait_for_timeout(300)
    pg.mouse.move(t["x"], t["y"]); pg.mouse.click(t["x"], t["y"]); pg.wait_for_timeout(150)
    print("8. click heatmap: no tooltip, no zones:", pg.locator("[role=tooltip]").count() == 0, pg.locator("[data-zone]").count() == 0)
    pg.click("[role=radio]:has-text('Scroll heatmap')"); pg.wait_for_timeout(200)
    pg.mouse.move(t["x"], t["y"] + 200); pg.wait_for_timeout(150)
    print("   scroll heatmap tooltip:", pg.inner_text("[role=tooltip]").replace("\n", " "))
    pg.click("[role=radio]:has-text('Table')"); pg.wait_for_timeout(200)
    print("9. table rows:", pg.locator("tbody tr").count(), "| first:", pg.locator("tbody tr").first.inner_text().replace("\t", " | ")[:120])
    pg.locator("tbody tr button:has-text('Show')").first.click(); pg.wait_for_timeout(300)
    print("   Show → zones view with the element selected:", pg.locator("[aria-label='Selected zone']").count() == 1)
    print("page errors:", errors or "none")
    b.close()
