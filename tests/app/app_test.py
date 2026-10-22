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
# Many more snapshots, each with its thumbnail: the list must stay quick.
PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
for i in range(40):
    docs.append({
        "id": f"old-{i}", "version": "1", "name": f"Footprints · /product/P{i} · 2026-09-01 10:00", "type": "footprints-snapshot",
        "description": json.dumps({"v": 2, "a": "Astroshop" if i % 4 else "easyTrade", "p": "x", "d": "mobile" if i % 5 == 0 else "desktop", "c": "auto", "l": f"/product/P{i % 25}"}),
        "content": snapshot, "modificationInfo": {"createdTime": f"2026-09-{1 + i % 28:02d}T10:00:00Z"},
    })
    docs.append({
        "id": f"thumb-{i}", "version": "1", "name": f"Footprints thumbnail · {i % 4} zones", "type": "footprints-thumbnail",
        "description": json.dumps({"v": 1, "s": f"old-{i}"}), "content": PIXEL, "modificationInfo": {"createdTime": "2026-09-01T10:00:00Z"},
    })

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

# Pictures as in Dynatrace: data URLs allowed, blob URLs blocked.
(HERE / "app_harness.html").write_text(f"""<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="img-src 'self' data: file:"></head><body>
<link rel="stylesheet" href="app_harness.css"><div id="root"></div><script>{script}</script><script src="app_harness.js"></script></body></html>""")

docs_of = lambda pg, t: pg.evaluate(f"window.__docs.filter(d => d.type === '{t}').map(d => [d.id, d.name, d.description])")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: ("Content Security Policy" in m.text or "405" in m.text) and errors.append(m.text[:120]))
    pg.goto((HERE / "app_harness.html").as_uri())
    pg.wait_for_selector("h2:has-text('Snapshots')")
    pg.wait_for_selector("[data-snapshot]")
    pg.wait_for_timeout(800)
    count = lambda part: sum(part in q for q in pg.evaluate("window.__dt.queries"))
    downloads = pg.evaluate("window.__downloads || []")
    print("1. snapshots screen: page-list queries:", count("by: {fp_page}"), "| cards:", pg.locator("[data-snapshot]").count(),
          "| snapshot contents downloaded:", sum(not d.startswith("thumb-") for d in downloads), "| thumbnails downloaded:", sum(d.startswith("thumb-") for d in downloads),
          "| pictures shown:", pg.locator("[data-snapshot] img").count())
    print("   first cards:", [t.replace("\n", " / ") for t in pg.locator("[data-snapshot]").all_inner_texts()[:3]])
    print("   sections:", pg.locator("main h3").all_inner_texts(), "| older:", pg.locator("button:has-text('older')").all_inner_texts())
    pg.mouse.wheel(0, 3000); pg.wait_for_timeout(800)
    print("   after scrolling, thumbnails downloaded:", sum(d.startswith("thumb-") for d in pg.evaluate("window.__downloads || []")))
    pg.mouse.wheel(0, -6000); pg.wait_for_timeout(200)
    pg.click("[role=radiogroup][aria-label=Device] >> text=Mobile"); pg.wait_for_timeout(200)
    print("   device filter Mobile:", pg.locator("[data-snapshot]").count(), "cards")
    pg.click("[role=radiogroup][aria-label=Device] >> text=All"); pg.wait_for_timeout(200)
    pg.screenshot(path=str(HERE / "app-snapshots.png"), full_page=False)

    pg.click("button:has-text('New snapshot')")
    pg.wait_for_selector("[role=dialog][aria-label='New snapshot']")
    print("2. panel open; page-list queries still:", count("by: {fp_page}"))
    pg.click("[role=dialog] button:has-text('Choose a page')")
    pg.wait_for_selector("[role=option]:has-text('product/P0')")
    print("   picker opened: page-list queries:", count("by: {fp_page}"), "| rows:", pg.locator("[role=option]").count())
    pg.click("[role=option]:has-text('/ (home page)')")
    print("   ways to take it:", [t.split("\n")[0] for t in pg.locator("[role=radio]").all_inner_texts()])
    # The extension (simulated): a desktop snapshot reports its progress, shown as a bar.
    pg.evaluate("""() => {
      window.postMessage({ source: 'footprints-extension', type: 'pong', version: '0.5.2' }, '*');
      window.addEventListener('message', (e) => {
        if (!e.data || e.data.source !== 'footprints-app' || e.data.type !== 'auto-snapshot') return;
        const id = e.data.requestId;
        const say = (text, pct) => window.postMessage({ source: 'footprints-extension', type: 'auto-progress', text, pct }, '*');
        setTimeout(() => say('Loading the pictures…', 30), 100);
        setTimeout(() => say('Taking the picture…', 64), 300);
        setTimeout(() => window.postMessage({ source: 'footprints-extension', type: 'auto-done', requestId: id, ok: true }, '*'), 2500);
      });
    }""")
    pg.wait_for_timeout(300)
    pg.click("[role=dialog] button:has-text('Take snapshot')")
    pg.wait_for_timeout(900)
    print("   progress bar:", pg.locator("text=64%").count() == 1, "|", pg.inner_text("[role=dialog] [role=status]").replace("\n", " ")[:90])
    pg.screenshot(path=str(HERE / "app-progress.png"))
    pg.wait_for_selector("text=Desktop snapshot saved", timeout=8000)
    print("   then:", pg.inner_text("text=Desktop snapshot saved"))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    print("   Escape closes the panel:", pg.locator("[role=dialog][aria-label='New snapshot']").count() == 0)

    pg.click("[data-snapshot='doc-0']")
    pg.wait_for_selector("text=Suggest zones", timeout=10000)
    pg.wait_for_timeout(500)
    print("3. analysis screen:", pg.inner_text("h2"), "|", pg.inner_text("[data-facts]"))
    print("   filters:", [t.split("\n")[0] for t in pg.locator("[aria-label=Filters] label").all_inner_texts()])
    print("   thumbnail made for the older snapshot:", [d for d in docs_of(pg, "footprints-thumbnail") if '"doc-0"' in d[2]])
    pg.screenshot(path=str(HERE / "app-analysis.png"))
    # Turn zones on and off quickly, several times: every change is saved, none is refused.
    img = pg.locator("img").first.bounding_box()
    for k in range(6):
        pg.mouse.click(img["x"] + 60 + 40 * (k % 3), img["y"] + 120 + 10 * k)
        pg.wait_for_timeout(250 if k % 2 else 700)
    pg.wait_for_timeout(2500)
    saved = pg.evaluate("window.__docs.find(d => d.id === 'doc-0').content.zoning")
    shown = pg.locator("[data-zone]").count()
    print("   quick clicks: error shown:", pg.locator("text=Could not save").count() > 0, "| zones on:", shown, "| saved:", len(saved["zones"]) if saved else None,
          "| version:", pg.evaluate("window.__docs.find(d => d.id === 'doc-0').version"))
    print("   thumbnail name now:", [d[1] for d in docs_of(pg, "footprints-thumbnail") if '"doc-0"' in d[2]])
    pg.click("button[aria-label='All snapshots']")
    pg.wait_for_selector("[data-snapshot='doc-0'] img", timeout=5000)
    print("   thumbnail size (KB):", pg.evaluate("Math.round(window.__docs.find(d => d.type === 'footprints-thumbnail' && d.description.includes('doc-0')).content.size / 1024)"),
          "| snapshot size (KB):", pg.evaluate("Math.round(JSON.stringify(window.__docs.find(d => d.id === 'doc-0').content).length / 1024)"))
    pg.locator("[data-snapshot='doc-0']").screenshot(path=str(HERE / "app-card.png"))
    print("4. back to the list; its card:", pg.inner_text("[data-snapshot='doc-0']").replace("\n", " / "))
    # A snapshot arriving from the extension is saved and opened.
    s2 = dict(snapshot, capturedAt="2026-10-21T12:00:00Z", capture="auto")
    pg.evaluate("s => window.postMessage({ source: 'footprints-extension', type: 'snapshot', deliveryId: 'd1', snapshot: s }, '*')", s2)
    pg.wait_for_selector("button[aria-label='All snapshots']", timeout=10000)
    pg.wait_for_selector("text=Suggest zones", timeout=10000)
    pg.wait_for_timeout(500)
    print("5. new snapshot opened automatically:", pg.inner_text("[data-facts]"))
    new_id = pg.evaluate("window.__docs.find(d => d.type === 'footprints-snapshot').id")
    print("   its thumbnails (exactly one):", len([d for d in docs_of(pg, "footprints-thumbnail") if f'"{new_id}"' in d[2]]))
    pg.click("button[aria-label='More actions']"); pg.wait_for_timeout(300)
    pg.click("[role=menuitem]:has-text('Delete snapshot')"); pg.wait_for_timeout(200)
    pg.click("[role=alert] button:has-text('Delete')")
    pg.wait_for_selector("h2:has-text('Snapshots')")
    pg.wait_for_timeout(500)
    print("6. deleted: snapshot gone:", pg.evaluate(f"!window.__docs.some(d => d.id === '{new_id}')"),
          "| thumbnail gone:", len([d for d in docs_of(pg, "footprints-thumbnail") if f'"{new_id}"' in d[2]]) == 0)
    print("page errors:", errors or "none")
    b.close()
