import functools, http.server, pathlib, tempfile, threading
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).parent; EXT = str(HERE.parent.parent / "extension")
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE)); h.func.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8124), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
from run import booking, payload
data = payload(booking); data["url"] = "http://localhost:8124/booking.html"
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, channel="chromium",
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
    if not ctx.service_workers: ctx.wait_for_event("serviceworker", timeout=10000)
    for shell in ["shell-same.html", "shell-strict.html"]:
        pg = ctx.new_page(); pg.goto(f"http://localhost:8124/{shell}")
        fr = pg.frame_locator("#f")
        try:
            fr.locator("#status").filter(has_text="pong").wait_for(timeout=5000)
            frame = [f for f in pg.frames if f.url.endswith("fake-app.html")][0]
            with ctx.expect_page(timeout=10000) as nt:
                frame.evaluate("p => window.footprintsShow(p)", data)
            tab = nt.value; tab.wait_for_selector("#footprints-overlay-host", state="attached", timeout=10000)
            print(f"{shell}: extension reached from the embedded frame, overlay drawn: OK")
        except Exception as e:
            print(f"{shell}: FAILED – {str(e).splitlines()[0]}")
    ctx.close()
srv.shutdown()
