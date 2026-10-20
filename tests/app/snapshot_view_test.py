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
data = {
    "snapshot": snapshot,
    "elements": elements,
    "scroll": {"step": 50, "steps": [[900, 20000], [1300, 20000]], "visits": 40000},
    "pageVisits": 40000,
    "device": "desktop",
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
    info = pg.inner_text("main, body").split("\n")
    print("coverage line:", next(l for l in info if "Snapshot taken" in l))
    print("labels on the map (Seen by):", pg.eval_on_selector_all("[data-area] span", "els => els.map(e => e.textContent)"))
    pg.click("text=Share of clicks")
    print("labels on the map (Share of clicks):", pg.eval_on_selector_all("[data-area] span", "els => els.map(e => e.textContent)"))
    print("areas in the sidebar:", pg.eval_on_selector_all("aside [aria-label^=Rename]", "els => els.map(e => e.getAttribute('aria-label'))"))

    # Hover the hero area and an element
    box = pg.eval_on_selector_all("[data-area]", "els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })")
    x, y, w, h = box[0]
    pg.mouse.move(x + w - 30, y + h - 30)
    pg.wait_for_timeout(150)
    print("hover card (area):", pg.inner_text("[role=tooltip]").replace("\n", " · ")[:160])

    # Rename the first area
    pg.click("aside [aria-label^=Rename] >> nth=0")
    pg.keyboard.press("Control+A")
    pg.keyboard.type("Product grid")
    pg.keyboard.press("Enter")
    print("rename callback:", pg.evaluate("window.renamed"))
    pg.screenshot(path=str(HERE / "snapshot-view.png"), full_page=True)
    print("page errors:", errors or "none")
    b.close()
