"""Automatic snapshots with the real extension: the app asks for a desktop and a
mobile snapshot; the extension loads the page in a background tab, takes a
full-page picture without the cookie bar, and measures the clicked elements at
other widths (the product grid changes from 5 to 4 to 2 columns)."""
import base64, functools, http.server, json, os, pathlib, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
EXT = str(HERE.parent.parent / "extension")
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
handler.func.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8126), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

from run import shop, payload

data = payload(shop)
data["url"] = "http://localhost:8126/responsive.html"
data["appId"] = "Astroshop"
data["pageVisits"] = 40000
data["scroll"] = None
data["scrollError"] = None

with sync_playwright() as p:
    # HEADED=1 (under xvfb-run): a real browser window smaller than the snapshot's,
    # like a laptop screen, where Chrome could squeeze the emulated page into the window.
    headed = os.environ.get("HEADED") == "1"
    ctx = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(), headless=not headed, channel="chromium",
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"] + (["--window-size=1100,700"] if headed else []),
        viewport=None if headed else {"width": 1500, "height": 900},
        # Playwright normally keeps background tabs running at full speed; real
        # Chrome does not, so let it treat the snapshot tab as a hidden one.
        ignore_default_args=["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
    )
    if not ctx.service_workers:
        ctx.wait_for_event("serviceworker", timeout=10000)
    app = ctx.new_page()
    app.goto("http://localhost:8126/fake-app.html")
    app.wait_for_function("document.getElementById('status').textContent === 'pong'", timeout=5000)
    app.evaluate("""() => { window.progress = []; window.done = [];
      window.addEventListener('message', e => { if (e.data && e.data.source === 'footprints-extension') {
        if (e.data.type === 'auto-progress') window.progress.push(e.data.text + ' ' + e.data.pct + '%');
        if (e.data.type === 'auto-done') window.done.push(e.data); } }); }""")

    # A visitor of the site may have zoomed it (Chrome remembers zoom per site): 90% here.
    if os.environ.get("ZOOM"):
        z = ctx.new_page()
        z.goto("http://localhost:8126/responsive.html")
        sw = ctx.service_workers[0]
        sw.evaluate("async (zoom) => { const [t] = await chrome.tabs.query({ url: 'http://localhost:8126/responsive.html' }); await chrome.tabs.setZoom(t.id, zoom); }", float(os.environ["ZOOM"]))
        z.wait_for_timeout(300)
        print("site zoom set to", os.environ["ZOOM"])
    for device, width, widths in [("desktop", 1280, [1280, 1440, 1920, 1366]), ("mobile", 390, [390, 360, 414])]:
        n = app.evaluate("window.snapshots.length")
        d = app.evaluate("window.done.length")
        tabs_before = len(ctx.pages)
        p_ = dict(data, capture={"device": device, "width": width, "widths": widths})
        app.evaluate("p => window.postMessage({ source: 'footprints-app', type: 'auto-snapshot', requestId: 'a1', payload: p }, '*')", p_)
        app.wait_for_function(f"window.done.length > {d}", timeout=90000)
        res = app.evaluate("window.done[window.done.length - 1]")
        print(f"[{device}] done:", res.get("ok"), res.get("error") or "")
        if not res.get("ok"):
            continue
        snap = app.evaluate(f"window.snapshots[{n}]")
        img = base64.b64decode(snap["image"]["dataUrl"].split(",", 1)[1])
        (HERE / f"auto-{device}.jpg").write_bytes(img)
        (HERE / f"auto-{device}.json").write_text(json.dumps(snap))
        print(f"  device {snap['device']}, viewport {snap['viewport']}, image {snap['image']['width']}x{snap['image']['height']} (scale {snap['image']['scale']}), page {snap['map']['page']}")
        print("  layouts:", [(l["width"], l["page"]["w"], len(l["boxes"])) for l in snap["layouts"]])
        first_add = [i for i, e in enumerate(snap["map"]["elements"]) if e["name"].startswith("Add")][4]
        print("  5th 'Add' button at each width:", [(l["width"], l["boxes"].get(str(first_add))) for l in snap["layouts"]])
        # The picture and the map agree: the red marker is where the map says.
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(img)).convert("RGB")
        mk = next(e for e in snap["map"]["elements"] if e["name"].startswith("Marker"))
        sc = snap["image"]["scale"]
        b = mk["box"]
        inside = im.getpixel((int((b["x"] + 5) * sc), int((b["y"] + b["h"] / 2) * sc)))
        above = im.getpixel((int((b["x"] + 5) * sc), int((b["y"] - 6) * sc)))
        below = im.getpixel((int((b["x"] + 5) * sc), int((b["y"] + b["h"] + 6) * sc)))
        red = lambda p: p[0] > 200 and p[1] < 60 and p[2] < 60
        print("  marker aligned (red inside its box, not just above or below):", red(inside) and not red(above) and not red(below), inside, above, below)
        m2 = next((e for e in snap["map"]["elements"] if e["name"].startswith("Blue")), None)
        if m2:
            b2 = m2["box"]
            px = im.getpixel((int((b2["x"] + b2["w"] / 2) * sc), int((b2["y"] + b2["h"] / 2) * sc)))
            print("  right-hand marker aligned (blue at the centre of its box):", px[2] > 200 and px[0] < 60 and px[1] < 60, px)
        top = im.crop((0, int(600 * sc), im.width, im.height)).convert("L")
        print("  sticky header not repeated further down:", sum(1 for px in top.get_flattened_data() if px < 30) < top.width * 20)
        for name in ("Product 10", "Product 9"):
            pe = next((e for e in snap["map"]["elements"] if e["name"].startswith(name) and e["box"]["w"] == 120), None)
            if pe:
                pb = pe["box"]
                px2 = im.getpixel((int((pb["x"] + pb["w"] / 2) * sc), int((pb["y"] + pb["h"] / 2) * sc)))
                print(f"  picture of {name} loaded (green):", px2[1] > 120 and px2[0] < 80, px2)
        pcts = app.evaluate("window.progress.map(t => parseInt(t.split(' ').pop()))")
        print("  background tab closed:", len(ctx.pages) == tabs_before, "| progress steps:", len(pcts), "| always moving forward:", all(b >= a for a, b in zip(pcts, pcts[1:])), "| first/last:", pcts[:1], pcts[-1:])
        app.evaluate("window.progress = []")
    ctx.close()
srv.shutdown()
