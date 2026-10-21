"""End to end with the real extension:
app -> new tab with overlay -> isolated panel -> Save snapshot -> snapshot back in the app."""
import base64, functools, http.server, io, json, pathlib, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
EXT = str(HERE.parent.parent / "extension")

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
handler.func.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8123), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

from run import shop, payload  # real tenant-like xpaths

data = payload(shop)
data["url"] = "http://localhost:8123/shop.html"
data["appId"] = "Astroshop"
data["pageVisits"] = 40000
data["scroll"] = {"step": 50, "steps": [[900, 20000], [1300, 20000]], "visits": 40000}
data["scrollError"] = None

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(), headless=True, channel="chromium",
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
        viewport={"width": 1440, "height": 900},
    )
    if not ctx.service_workers:
        ctx.wait_for_event("serviceworker", timeout=10000)
    app = ctx.new_page()
    app.goto("http://localhost:8123/fake-app.html")
    app.wait_for_function("document.getElementById('status').textContent === 'pong'", timeout=5000)
    print("1. extension answered the app: OK")

    with ctx.expect_page(timeout=10000) as new_tab:
        app.evaluate("p => window.footprintsShow(p)", data)
    tab = new_tab.value
    tab.wait_for_load_state("load")
    # Simulates the site's analytics: a listener that sees every click on the page.
    tab.evaluate("() => { window.pageClicks = 0; document.addEventListener('click', () => window.pageClicks++, true); }")
    app.wait_for_function("document.getElementById('status').textContent.startsWith('shown')", timeout=5000)
    print("2. app got confirmation:", app.inner_text("#status"))

    panel = None
    for _ in range(50):
        panel = next((f for f in tab.frames if f.url.startswith("chrome-extension://") and "panel.html" in f.url), None)
        if panel and panel.query_selector(".primary"):
            break
        tab.wait_for_timeout(200)
    print("3. panel runs in an isolated extension frame:", bool(panel and panel.query_selector(".primary")))

    panel.click("[data-act=collapse]")
    tab.wait_for_timeout(300)
    panel.click("[data-act=expand]")
    tab.wait_for_timeout(300)
    print("4. clicks on the panel seen by the page's scripts:", tab.evaluate("window.pageClicks"))

    panel.click("[data-act=save]")
    app.wait_for_function("window.snapshots.length > 0", timeout=60000)
    snap = app.evaluate("() => window.snapshots[0]")
    tab.wait_for_timeout(500)
    print("5. snapshot delivered to the app; panel says:", panel.inner_text("[role=status]"))
    img = base64.b64decode(snap["image"]["dataUrl"].split(",", 1)[1])
    (HERE / "snapshot.jpg").write_bytes(img)
    (HERE / "snapshot.json").write_text(json.dumps(snap))
    m = snap["map"]
    found = [e for e in m["elements"] if e["keys"][0].startswith("[")]
    print(f"   image {snap['image']['width']}x{snap['image']['height']} px, {len(img)//1024} KB")
    print(f"   map: page {m['page']}, {len(m['areas'])} areas, {len(m['elements'])} elements, {len(found)} matched to data rows")
    print("   area names:", [a["name"] for a in m["areas"]][:8])
    print("   sample keys:", found[0]["keys"][:3] if found else None)
    print("   overlay hidden in the picture (no orange areas):", "check snapshot.jpg")
    print("   page scrolled back:", tab.evaluate("window.scrollY") == 0, "| overlay visible again:", tab.evaluate("!!document.getElementById('footprints-overlay-host') && document.getElementById('footprints-overlay-host').style.display !== 'none'"))
    ctx.close()
srv.shutdown()
