"""Pointing at the page shows its numbers; the page itself keeps working; scrolling works."""
from playwright.sync_api import sync_playwright
from run import OVERLAY, HERE, payload, shop

SHADOW = "window.__footprints.debug.root()"


def detail(page):
    return page.evaluate(f"() => {SHADOW}.getElementById('fp-detail-box').innerText.replace(/\\s+/g, ' ').trim()")


def center(page, selector, nth=0):
    return page.evaluate(
        f"() => {{ const r = document.querySelectorAll({selector!r})[{nth}].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }}"
    )


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto((HERE / "shop.html").as_uri())
    pg.evaluate("() => { window.siteClicks = 0; document.querySelectorAll('button, a').forEach(n => n.addEventListener('click', () => window.siteClicks++)); }")
    pg.add_script_tag(path=OVERLAY)
    data = payload(shop)
    data["pageVisits"] = 40000
    pg.evaluate("p => window.__footprints.show(p)", data)
    pg.wait_for_timeout(2500)
    print("panel mode outside the extension:", pg.evaluate("window.__footprints.debug.panelMode()"))

    x, y = center(pg, ".hero button")
    pg.mouse.move(x, y)
    pg.wait_for_timeout(200)
    print("hover 'Shop now':", detail(pg)[:110])

    pg.mouse.click(x, y)
    print("click on the page reaches the site:", pg.evaluate("window.siteClicks") == 1)

    x2, y2 = center(pg, ".prod", 3)
    pg.mouse.move(x2, y2 + 60)
    pg.wait_for_timeout(200)
    print("hover inside a product card:", detail(pg)[:90])
    chips = pg.evaluate(f"() => Array.from({SHADOW}.querySelectorAll('.chip')).map(c => c.textContent)")
    print("labels on the page are numbers only:", chips)
    pg.screenshot(path=str(HERE / "inspect.png"))
    b.close()

# Scrolling keeps working with the overlay on.
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 600})
    pg.goto((HERE / "shop.html").as_uri())
    pg.add_script_tag(path=OVERLAY)
    pg.evaluate("p => window.__footprints.show(p)", payload(shop))
    pg.wait_for_timeout(1500)
    pg.mouse.move(400, 300)
    pg.mouse.wheel(0, 500)
    pg.wait_for_timeout(500)
    print("scroll with the overlay on, page moved by:", pg.evaluate("window.scrollY"), "px")
    b.close()
