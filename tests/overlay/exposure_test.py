"""Exposure: how many visits see each part of the page, from a known scroll distribution.

Page (desktop, 1440 wide): header 0-80, hero 80-700, story 700-1600,
carousel 1600-2000, footer 2000-2120.

Visits: 1000. Deepest point seen:
  400 visits stop at 900 px (first screen only)
  300 visits reach 1700 px
  300 visits reach the bottom (2150 px)
Expected:
  hero     -> 100%   (seen on the first screen)
  carousel -> 30%    (counted when 200 px of it — half its height — is in view: 1800 px)
  story    -> 60%    (counted at its first 300 px: 1000 px)
"""
from playwright.sync_api import sync_playwright
from run import OVERLAY, HERE

SHADOW = "window.__footprints.debug.root()"
B = ["html", "body"]
elements = [
    {"xpath": B + ["section", "div", "button"], "clicks": 500, "visits": 450, "label": "Start now"},
    {"xpath": B + ["section[3]", "div", "button"], "clicks": 60, "visits": 54, "label": "Read 1"},
    {"xpath": B + ["section[3]", "div[2]", "button"], "clicks": 30, "visits": 27, "label": "Read 2"},
]
STEP = 50
steps = [[900, 400], [1700, 300], [2150, 300]]
payload = {
    "kind": "footprints-page", "v": 1, "app": "Test", "page": "x", "url": "x",
    "period": "Last 7 days", "device": "Desktop", "deviceKey": "desktop", "pageVisits": 1000,
    "elements": elements, "scroll": {"step": STEP, "steps": steps, "visits": 1000}, "scrollError": None,
}


def text(pg, js):
    return pg.evaluate(f"() => {js}")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto((HERE / "long.html").as_uri())
    pg.add_script_tag(path=OVERLAY)
    pg.evaluate("p => window.__footprints.show(p)", payload)
    pg.wait_for_timeout(1500)

    folds = text(pg, f"Array.from({SHADOW}.querySelectorAll('.fold')).map(f => f.style.top + ' ' + f.textContent.trim())")
    print("scroll lines:", folds)
    print("list:", text(pg, f"Array.from({SHADOW}.querySelectorAll('.item')).map(i => i.innerText.replace(/\\s+/g, ' '))"))

    def inspect(selector, nth=0):
        r = pg.evaluate(f"() => {{ const e = document.querySelectorAll('{selector}')[{nth}]; e.scrollIntoView({{block: 'center'}}); const r = e.getBoundingClientRect(); return [r.left + 10, r.top + 10]; }}")
        pg.wait_for_timeout(300)
        pg.mouse.move(*r)
        pg.wait_for_timeout(300)
        return text(pg, f"{SHADOW}.getElementById('fp-detail-box').innerText.replace(/\\s+/g, ' ').trim()")

    print("hero button:", inspect(".hero button"))
    print("carousel 1st button:", inspect(".carousel button"))
    print("carousel (empty part):", inspect(".carousel"))
    print("story (no clicks):", inspect(".story p"))
    pg.evaluate("() => window.scrollTo(0, 1100)")
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(HERE / "exposure.png"))
    b.close()
