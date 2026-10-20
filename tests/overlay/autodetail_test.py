"""Product cards clicked on their picture (no text): names come from the card; page opens split in areas."""
from playwright.sync_api import sync_playwright
from run import OVERLAY, HERE

SHADOW = "window.__footprints.debug.root()"
N = ["html", "body", 'div[@id="__next"]', "main", "div[2]", "div"]
elements = [{"xpath": N + [f"div[{k}]", "div"], "clicks": 300 - k, "visits": 200 - k, "label": "Area"} for k in range(1, 11)]
elements.append({"xpath": ["html", "body", 'div[@id="__next"]', "main", "div", "div", "button"], "clicks": 2, "visits": 1, "label": "Go Shopping"})
payload = {"kind": "footprints-page", "v": 1, "app": "Astroshop", "page": "x", "url": "x", "period": "Last 7 days",
           "device": "Desktop", "deviceKey": "desktop", "pageVisits": 1000, "elements": elements,
           "scroll": {"step": 50, "steps": [[900, 300], [1500, 400], [2400, 300]], "visits": 1000}, "scrollError": None}

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto((HERE / "astro.html").as_uri())
    pg.add_script_tag(path=OVERLAY)
    pg.evaluate("p => window.__footprints.show(p)", payload)
    pg.wait_for_timeout(1500)
    print("starting detail:", pg.evaluate(f"() => {SHADOW}.getElementById('fp-detail').value"))
    print("areas:", pg.evaluate(f"() => Array.from({SHADOW}.querySelectorAll('.chip')).map(c => c.textContent)"))
    pg.evaluate("() => document.querySelectorAll('.card')[1].scrollIntoView({block: 'center'})")
    pg.wait_for_timeout(300)
    r = pg.evaluate("() => { const e = document.querySelectorAll('.card')[1].getBoundingClientRect(); return [e.left + e.width / 2, e.top + 200]; }")
    pg.mouse.move(*r)
    pg.wait_for_timeout(300)
    print("inspect a picture:", pg.evaluate(f"() => {SHADOW}.getElementById('fp-detail-box').innerText.replace(/\\s+/g, ' ').slice(0, 160)"))
    pg.evaluate(f"() => {{ const s = {SHADOW}.getElementById('fp-detail'); s.value = '1'; s.dispatchEvent(new Event('change', {{bubbles: true}})); }}")
    pg.wait_for_timeout(300)
    pg.mouse.move(r[0], r[1] + 1)
    pg.wait_for_timeout(300)
    print("detail 1, inspect the big area:", pg.evaluate(f"() => {SHADOW}.getElementById('fp-detail-box').innerText.replace(/\\s+/g, ' ').slice(0, 260)"))
    pg.screenshot(path=str(HERE / "autodetail.png"))
    b.close()
