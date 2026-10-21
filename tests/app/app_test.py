"""The whole app with a simulated Dynatrace (tests/app/mock): the snapshots
screen loads no page list until the page picker is opened; a saved snapshot
opens the analysis screen; back to the list; a snapshot from the extension
opens by itself."""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "overlay"))
from run import shop  # noqa: E402

snapshot = json.loads((HERE.parent / "overlay" / "snapshot.json").read_text())
home = "https://astroshop.example.com/"
snapshot["page"] = home
snapshot["appId"] = "Astroshop"
elements = [{"section": json.dumps(x), "clicks": c, "visits": v, "name": "x", "tag": "button", "node": "button"} for x, c, v in shop]
pages = [{"fp_page": home, "clicks": 9000, "visits": 40000}] + [{"fp_page": f"{home}product/P{i}", "clicks": 100, "visits": 3000 - i} for i in range(30)]
docs = [{
    "id": "doc-0", "version": "1", "name": "Footprints · / (home page) · 2026-10-20 15:09", "type": "footprints-snapshot",
    "description": json.dumps({"v": 1, "a": "Astroshop", "p": "x", "d": "desktop"}),
    "content": snapshot, "modificationInfo": {"createdTime": "2026-10-20T13:09:00Z"},
}]

script = """
window.__docs = %s;
window.__dt = { queries: [], rows: (q) => {
  const D = %s;
  if (q.includes("by: {app}")) return [{ app: "Astroshop" }, { app: "easyTrade" }];
  if (q.includes("by: {fp_page}")) return D.pages;
  if (q.includes("by: {section = toString(ui_element.xpath), width")) return [];
  if (q.includes("by: {width = browser.window.width}")) return [{ width: 1280, clicks: 900 }];
  if (q.includes("bin(seen")) return [{ depth: 900, visits: 20000 }, { depth: 1300, visits: 20000 }];
  if (q.includes("by: {section}") && q.includes("converted")) return [];
  if (q.includes("converted")) return [{ visits: 40000, converted: 4000 }];
  if (q.includes("by: {section}")) return D.elements;
  if (q.includes("countDistinct(dt.rum.session.id)")) return [{ visits: 40000 }];
  return [];
} };
""" % (json.dumps(docs), json.dumps({"pages": pages, "elements": elements}))

(HERE / "app_harness.html").write_text(f"""<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="root"></div><script>{script}</script><script src="app_harness.js"></script></body></html>""")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto((HERE / "app_harness.html").as_uri())
    pg.wait_for_selector("text=Your snapshots")
    pg.wait_for_selector("[role=listitem]")
    pg.wait_for_timeout(500)
    count = lambda part: sum(part in q for q in pg.evaluate("window.__dt.queries"))
    print("1. snapshots screen: page-list queries before opening the picker:", count("by: {fp_page}"))
    print("   saved snapshots listed:", pg.locator("[role=listitem]").all_inner_texts())
    pg.click("button:has-text('Choose a page')")
    pg.wait_for_selector("[role=option]:has-text('product/P0')")
    print("2. picker opened: page-list queries:", count("by: {fp_page}"), "| rows:", pg.locator("[role=option]").count())
    pg.click("[role=option]:has-text('/ (home page)')")
    print("   capture buttons:", pg.locator("button:has-text('snapshot'), button:has-text('Open the page')").all_inner_texts())
    pg.click("[role=listitem] >> nth=0")
    pg.wait_for_selector("text=Suggest zones", timeout=10000)
    print("3. analysis screen:", pg.inner_text("h1"), "|", pg.locator("h1 + p").inner_text())
    print("   filters:", [t.split("\n")[0] for t in pg.locator("section[aria-label=Filters] label, section[aria-label=Filters] span").all_inner_texts()][:4])
    print("   device filter gone:", pg.locator("text=Tablet").count() == 0)
    pg.click("text=‹ All snapshots")
    pg.wait_for_selector("text=Your snapshots")
    print("4. back to the list: OK")
    # A snapshot arriving from the extension is saved and opened.
    s2 = dict(snapshot, capturedAt="2026-10-21T12:00:00Z", capture="auto")
    pg.evaluate("s => window.postMessage({ source: 'footprints-extension', type: 'snapshot', deliveryId: 'd1', snapshot: s }, '*')", s2)
    pg.wait_for_selector("text=‹ All snapshots", timeout=10000)
    pg.wait_for_selector("text=Suggest zones", timeout=10000)
    print("5. new snapshot opened automatically:", pg.locator("h1 + p").inner_text())
    pg.click("text=‹ All snapshots")
    pg.wait_for_selector("text=Your snapshots")
    pg.wait_for_timeout(300)
    print("   list now:", pg.locator("[role=listitem]").all_inner_texts())
    pg.screenshot(path=str(HERE / "app-snapshots.png"), full_page=True)
    print("page errors:", errors or "none")
    b.close()
