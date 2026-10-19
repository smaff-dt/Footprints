"""End to end: real extension, fake app page -> new tab with the overlay."""
import functools, http.server, pathlib, tempfile, threading, json, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).parent))
HERE = pathlib.Path(__file__).parent
EXT = str(HERE.parent.parent / "extension")

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
handler.func.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8123), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

from run import booking, payload  # reuse the real tenant xpaths

data = payload(booking)
data["url"] = "http://localhost:8123/booking.html"

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(), headless=True, channel="chromium",
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
        viewport={"width": 1440, "height": 900},
    )
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=10000)
    print("extension worker:", sw.url.split("/")[2][:8] + "…")
    app = ctx.new_page()
    app.goto("http://localhost:8123/fake-app.html")
    app.wait_for_function("document.getElementById('status').textContent === 'pong'", timeout=5000)
    print("1. extension answered the app (pong): OK")
    with ctx.expect_page(timeout=10000) as new_tab:
        app.evaluate("p => window.footprintsShow(p)", data)
    tab = new_tab.value
    tab.wait_for_load_state("load")
    app.wait_for_function("document.getElementById('status').textContent.startsWith('shown')", timeout=5000)
    print("2. app got confirmation:", app.inner_text("#status"))
    print("3. new tab opened:", tab.url)
    tab.wait_for_selector("#footprints-overlay-host", state="attached", timeout=10000)
    tab.wait_for_timeout(2500)
    chips = tab.evaluate("() => Array.from(document.getElementById('footprints-overlay-host').shadowRoot.querySelectorAll('.chip')).map(c => c.textContent)")
    print("4. overlay drawn with areas:", chips)
    tab.reload()
    tab.wait_for_selector("#footprints-overlay-host", state="attached", timeout=10000)
    print("5. overlay comes back after reload: OK")
    tab.screenshot(path=str(HERE / "e2e.png"))
    ctx.close()
srv.shutdown()
