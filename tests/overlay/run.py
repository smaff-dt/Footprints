"""Loads the overlay on two test pages built from real tenant xpaths and checks it."""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
OVERLAY = str(HERE.parent.parent / "extension" / "overlay.js")

P = ["html", "body", "app-root", "app-book-journey", "app-main-layout", "div"]
booking = [
    (P + ["div", "main", "div2", "app-login-form", "form", 'button@id="loginForm:submit"'], 1152, 1152),
    (P + ["div", "main", "div[2]", "app-login-form", "form", 'button[@id="loginForm:submit"]'], 93, 93),
    (P + ["div", "main", "div2", "app-login-form", "form", 'input@id="loginForm:password"'], 1152, 1152),
    (P + ["div", "main", "div2", "app-login-form", "form", "div", 'input@id="loginForm:username"'], 1151, 1151),
    (P + ["div", "main", "div2", "div", "p3", "button"], 1152, 1152),
    (P + ["div", "main", "div[2]", "div", "p[3]", "button"], 92, 92),
    (P + ["div", "main", "div2", "app-billing", "div", "div", "h2", "div", "fa-icon"], 864, 864),
    (P + ["div", "main", "div2", "app-billing", "div", "div", "div3", "button"], 863, 863),
    (P + ["div", "main", "div[2]", "app-billing", "div", "div", "div[3]", "button"], 184, 184),
    (P + ["app-header", "header", "nav", 'a[@id="header:logout"]'], 91, 91),
    (P + ["div", "main", "div[2]", "div[2]", 'button[@id="summaryButton"]'], 55, 55),
]
N = ["html", "body", 'div[@id="__next"]']
shop = [(N + ["div", "div", "a[2]"], 400, 380), (N + ["main", "div", "div", "button"], 9000, 8000)]
shop += [(N + ["main", "div[2]", "div", f"div[{k}]", "button"], 3000 - 100 * k, 2900 - 100 * k) for k in range(1, 11)]
shop += [(N + ["div[2]", "a"], 120, 110), (["html", "body"], 700, 650), (N + ["main", "div[3]", "button"], 300, 300)]


def payload(rows, device="desktop"):
    return {
        "kind": "footprints-page", "v": 1, "app": "Test", "page": "x", "url": "x",
        "period": "Last 7 days", "device": "Desktop", "deviceKey": device,
        "elements": [{"xpath": x, "clicks": c, "visits": v, "label": "/".join(x[-2:])} for x, c, v in rows],
    }


def run(page, name, rows, details):
    page.goto((HERE / f"{name}.html").as_uri())
    page.add_script_tag(path=OVERLAY)
    found = page.evaluate(
        "rows => rows.map(r => { const el = window.__footprints.findElement(r); return el ? (el.id || el.localName + ':' + (el.textContent||'').trim().slice(0,12)) : null; })",
        [x for x, _, _ in rows],
    )
    for (x, _, _), f in zip(rows, found):
        print(f"  {'OK ' if f else 'MISS'} {'/'.join(x[-3:]):55} -> {f}")
    page.evaluate("p => window.__footprints.show(p)", payload(rows))
    page.wait_for_timeout(2500)
    for d in details:
        page.evaluate(f"""() => {{ const r = window.__footprints.debug.root();
            const s = r.getElementById('fp-detail'); s.value = '{d}'; s.dispatchEvent(new Event('change', {{bubbles: true}})); }}""")
        page.wait_for_timeout(300)
        chips = page.evaluate("() => Array.from(window.__footprints.debug.root().querySelectorAll('.chip')).map(c => c.textContent)")
        notes = page.evaluate("() => Array.from(window.__footprints.debug.root().querySelectorAll('.note')).map(c => c.textContent)")
        print(f"  detail {d}: {len(chips)} areas -> {chips}")
        for n in notes:
            print(f"    note: {n}")
        page.screenshot(path=str(HERE / f"{name}-detail{d}.png"), full_page=True)


if __name__ == "__main__":
  with sync_playwright() as p:
      b = p.chromium.launch()
      pg = b.new_page(viewport={"width": 1440, "height": 900})
      errors = []
      pg.on("pageerror", lambda e: errors.append(str(e)))
      print("BOOKING (Angular-like, both xpath spellings)")
      run(pg, "booking", booking, [1, 2, 3, 4])
      print("SHOP (React-like, no components)")
      run(pg, "shop", shop, [1, 2, 3, 4])
      print("page errors:", errors or "none")
      b.close()
