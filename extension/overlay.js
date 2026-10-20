/**
 * Footprints – overlay drawn on the live page.
 *
 * 1. Finds every clicked element on the page from the xpath that Dynatrace
 *    recorded for it (both spellings seen in the data: `div[2]` and `div2`,
 *    `a[@id="x"]` and `a@id="x"`).
 * 2. Divides the page into areas automatically, from what the page itself
 *    looks like: landmarks (header, navigation, footer…), named components and
 *    large visual blocks. A single "Detail" slider chooses between fewer,
 *    larger areas and more, smaller ones. Nothing has to be configured.
 * 3. Colors each area by the chosen metric (share of clicks, or how many
 *    visits see it) and lists the areas in a side panel.
 * 4. Saves a snapshot: a picture of the whole page plus a map of its areas
 *    and elements, sent to the Footprints app for analysis.
 *
 * Drawings live in a closed shadow root and never receive clicks. The panel
 * runs in an extension iframe, so clicks on it do not reach the website's own
 * analytics. Nothing on the site is changed.
 */
(() => {
  if (window.__footprints) return;

  // ── Finding clicked elements ──────────────────────────────────────────────

  const HEADING = /^h[1-6]$/i;

  /** Possible readings of one recorded xpath segment, most likely first. */
  function readSegment(raw) {
    const seg = String(raw).trim();
    let m;
    if ((m = /^\/\/\*\[@id=\\?"(.+?)\\?"\]$/.exec(seg))) return [{ anyId: m[1] }];
    if ((m = /^([a-zA-Z][\w-]*?)\[@id=\\?"(.+?)\\?"\]$/.exec(seg))) return [{ tag: m[1], id: m[2] }];
    if ((m = /^([a-zA-Z][\w-]*?)@id=\\?"(.+?)\\?"$/.exec(seg))) return [{ tag: m[1], id: m[2] }];
    if ((m = /^([a-zA-Z][\w-]*)\[(\d+)\]$/.exec(seg))) return [{ tag: m[1], index: Number(m[2]) }];
    if (!HEADING.test(seg) && (m = /^([a-zA-Z](?:[\w-]*?[a-zA-Z-])?)(\d+)$/.exec(seg))) {
      // `div2` means the second div – but `app-offer2` may be a tag name.
      return [
        { tag: m[1], index: Number(m[2]) },
        { tag: seg, index: 1 },
      ];
    }
    if ((m = /^([a-zA-Z][\w-]*)/.exec(seg))) return [{ tag: m[1], index: 1 }];
    return [];
  }

  function childrenNamed(parent, tag) {
    const name = tag.toLowerCase();
    return Array.from(parent.children).filter((c) => c.localName === name);
  }

  /** Walks the recorded path from the top of the page; null if not found. */
  function findElement(path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    let node = null;
    let start = 0;
    const first = readSegment(path[0])[0];
    if (first && first.anyId) {
      node = document.getElementById(first.anyId);
      start = 1;
    } else if (first && first.tag === "html") {
      node = document.documentElement;
      start = 1;
    } else {
      node = document.documentElement;
    }
    for (let i = start; node && i < path.length; i++) {
      let next = null;
      for (const r of readSegment(path[i])) {
        const kids = childrenNamed(node, r.tag || "*");
        if (r.id) {
          next = kids.find((k) => k.id === r.id) || null;
          if (!next) {
            const byId = document.getElementById(r.id);
            if (byId && byId.localName === r.tag.toLowerCase()) next = byId;
          }
        } else {
          next = kids[(r.index || 1) - 1] || null;
        }
        if (next) break;
      }
      node = next;
    }
    return node;
  }

  // ── Areas ─────────────────────────────────────────────────────────────────

  const LANDMARK_NAMES = {
    header: "Header",
    nav: "Navigation",
    footer: "Footer",
    aside: "Sidebar",
    main: "Main content",
    dialog: "Dialog",
  };
  const ROLE_NAMES = {
    banner: "Header",
    navigation: "Navigation",
    contentinfo: "Footer",
    complementary: "Sidebar",
    main: "Main content",
    dialog: "Dialog",
    search: "Search",
    form: "Form",
  };
  const SEMANTIC = new Set(["header", "nav", "footer", "aside", "main", "dialog", "section", "article", "form", "fieldset"]);

  function isComponent(el) {
    const n = el.localName;
    return n.includes("-") && !/-(icon|root)$/.test(n) && !n.startsWith("fa-");
  }

  function pageBox(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  function pageArea() {
    const d = document.documentElement;
    return Math.max(d.scrollWidth, window.innerWidth) * Math.max(d.scrollHeight, window.innerHeight);
  }

  function isTransparent(color) {
    return !color || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
  }

  /** A block with its own background (a bar, a card, a banner) reads as an area. */
  function hasOwnBackground(el) {
    const s = getComputedStyle(el);
    if (s.backgroundImage && s.backgroundImage !== "none") return true;
    if (isTransparent(s.backgroundColor)) return false;
    const parent = el.parentElement ? getComputedStyle(el.parentElement).backgroundColor : "";
    return s.backgroundColor !== parent;
  }

  function isArea(el, total, cache) {
    if (cache.has(el)) return cache.get(el);
    let result = false;
    if (el !== document.body && el !== document.documentElement) {
      const b = pageBox(el);
      if (b.w >= 120 && b.h >= 32) {
        const size = b.w * b.h;
        const role = el.getAttribute("role");
        if (size <= 0.9 * total) {
          if (SEMANTIC.has(el.localName) || (role && ROLE_NAMES[role]) || isComponent(el)) result = true;
          else if (size >= 0.015 * total && (el.children.length >= 2 || hasOwnBackground(el))) result = true;
        }
      }
    }
    cache.set(el, result);
    return result;
  }

  function sameBox(a, b) {
    return Math.abs(a.x - b.x) < 6 && Math.abs(a.y - b.y) < 6 && Math.abs(a.w - b.w) < 6 && Math.abs(a.h - b.h) < 6;
  }

  /** The areas around an element, from the largest to the smallest. */
  function areaChain(el, total, cache) {
    const chain = [];
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (isArea(n, total, cache)) chain.unshift(n);
    }
    // A wrapper exactly the size of its child adds nothing: keep the outer one.
    const out = [];
    for (const n of chain) {
      if (out.length && sameBox(pageBox(out[out.length - 1]), pageBox(n))) continue;
      out.push(n);
    }
    return out;
  }

  function clip(text, max) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  function prettyTag(name) {
    const t = name.replace(/^(app|ng|my|x|ui)-/, "").replace(/[-_]+/g, " ").replace(/(\D)(\d+)$/, "$1 $2");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  const HEADINGS = "h1, h2, h3, h4, legend, [role=heading]";

  /** True if `node` sits inside a smaller area nested in `el`. */
  function insideNestedArea(node, el, ctx) {
    const box = pageBox(el);
    for (let n = node.parentElement; n && n !== el; n = n.parentElement) {
      if (isArea(n, ctx.total, ctx.cache) && !sameBox(pageBox(n), box)) return true;
    }
    return false;
  }

  /** The heading that belongs to this area itself, not to a box inside it. */
  function ownHeading(el, ctx) {
    for (const h of el.querySelectorAll(HEADINGS)) {
      if (h.textContent.trim() && !insideNestedArea(h, el, ctx)) return clip(h.textContent, 32);
    }
    return "";
  }

  /** A heading right before the element, e.g. "Hot products" above a product grid. */
  function headingBefore(el) {
    const prev = el.previousElementSibling;
    if (prev && prev.matches(HEADINGS) && prev.textContent.trim()) return clip(prev.textContent, 28);
    return "";
  }

  /** Three or more children that look alike: a list of products, cards, links… */
  function repeatedChildren(el) {
    // Only box-like children count (cards, tiles, rows): not lines of text.
    const kids = Array.from(el.children).filter((k) => {
      const r = k.getBoundingClientRect();
      return r.width >= 80 && r.height >= 40;
    });
    if (kids.length < 3) return 0;
    const sig = (k) => `${k.localName}.${k.className}`;
    const counts = new Map();
    kids.forEach((k) => counts.set(sig(k), (counts.get(sig(k)) || 0) + 1));
    const top = Math.max(...counts.values());
    return top >= 3 && top >= kids.length * 0.6 ? top : 0;
  }

  function firstLine(el) {
    const line = (el.innerText || "").split("\n").map((l) => l.trim()).find(Boolean);
    return line ? `“${clip(line, 26)}”` : "";
  }

  function childAreas(el, ctx) {
    const box = pageBox(el);
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (isArea(c, ctx.total, ctx.cache) && !sameBox(pageBox(c), box)) out.push(c);
        else walk(c);
      }
    };
    walk(el);
    return out;
  }

  /** A readable name for an area, taken from the page itself. */
  function areaName(el, ctx, nested) {
    const aria = el.getAttribute("aria-label");
    const role = el.getAttribute("role");
    const landmark = LANDMARK_NAMES[el.localName] || (role && ROLE_NAMES[role]);
    if (landmark) return aria ? `${landmark}: ${clip(aria, 24)}` : landmark;

    // Full-width bars at the very top or bottom of the page.
    const b = pageBox(el);
    const d = document.documentElement;
    const pageW = Math.max(d.scrollWidth, window.innerWidth);
    const pageH = Math.max(d.scrollHeight, window.innerHeight);
    if (b.w >= 0.9 * pageW && b.h <= 240) {
      if (b.y <= 4) return "Header";
      if (b.y + b.h >= pageH - 4) return "Footer";
    }

    if (aria) return clip(aria, 32);
    const heading = ownHeading(el, ctx);
    if (heading) return heading;
    const items = repeatedChildren(el);
    if (items) return `${headingBefore(el) || "List"} (${items} items)`;
    if (isComponent(el)) return prettyTag(el.localName);
    if (el.localName === "form") return "Form";
    if (!nested) {
      const kids = childAreas(el, ctx);
      if (kids.length >= 2) {
        const names = kids.slice(0, 2).map((k) => areaName(k, ctx, true));
        return clip(`${names.join(" + ")}${kids.length > 2 ? ` +${kids.length - 2}` : ""}`, 40);
      }
    }
    return firstLine(el) || "Area";
  }


  // ── State ─────────────────────────────────────────────────────────────────

  const state = {
    payload: null,
    detail: 2,
    metric: "share", // "share": share of the page's clicks · "seen": share of visits that see it
    showDots: true,
    showFolds: true,
    collapsed: false,
    areas: [],
    rest: null,
    hover: null, // what is under the pointer
    found: [], // { el, row }
    missing: [], // rows not found on the page
    byEl: new Map(), // clicked element -> row
    saving: null, // { kind: "busy" | "done" | "pending" | "error", text }
  };

  // Drawing layer: a closed shadow root, never interactive (pointer-events: none),
  // so nothing drawn on the page can receive clicks.
  let host = null;
  let root = null;

  const LAYER_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .layer { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
    .area { position: absolute; border-radius: 6px; border: 2px solid rgba(184,70,26,.75); }
    .chip { position: absolute; left: 4px; top: 4px; display: inline-flex; padding: 3px 8px; border-radius: 999px;
      font-size: 12px; font-weight: 800; line-height: 1.4; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
    .dot { position: absolute; border-radius: 50%; transform: translate(-50%, -50%);
      background: rgba(47,75,216,.85); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
    .hl { position: absolute; display: none; border-radius: 6px; border: 3px solid #2F4BD8;
      box-shadow: 0 0 0 4px rgba(47,75,216,.25); }
    .hl.area-target { border-style: dashed; }
    .fold { position: absolute; left: 0; height: 0; border-top: 2px dashed rgba(47,75,216,.85); }
    .fold span { position: absolute; left: 8px; top: -21px; padding: 2px 8px; border-radius: 6px 6px 0 0;
      background: #2F4BD8; color: #fff; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .panel-frame { position: fixed; top: 12px; right: 12px; width: 340px; height: 120px; max-height: calc(100vh - 24px);
      border: 0; border-radius: 14px; box-shadow: 0 8px 28px rgba(22,25,31,.22); background: #fff; pointer-events: auto;
      color-scheme: light; }
    .panel-inline { position: fixed; top: 12px; right: 12px; width: 340px; max-height: calc(100vh - 24px); overflow: auto;
      pointer-events: auto; border-radius: 14px; box-shadow: 0 8px 28px rgba(22,25,31,.22); background: #fff; }
  `;

  // Panel styles, shared by the isolated panel (panel.html) and the in-page fallback.
  const PANEL_CSS = `
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel { background: #fff; color: #16191F; border: 1px solid #E2E5EA; border-radius: 14px; padding: 14px;
      font-size: 13px; line-height: 1.45; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .brand { font-weight: 800; font-size: 15px; }
    .muted { color: #5B6270; }
    .btn { min-height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid #CDD2DA; background: #fff;
      color: #16191F; font-size: 12px; font-weight: 600; cursor: pointer; }
    .primary { width: 100%; min-height: 40px; margin-top: 10px; border-radius: 10px; border: 1px solid #16191F;
      background: #16191F; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
    .primary[disabled] { opacity: .6; cursor: progress; }
    button:focus-visible, input:focus-visible { outline: 3px solid #2F4BD8; outline-offset: 2px; }
    .seg { display: flex; gap: 3px; padding: 3px; margin-top: 10px; background: #F1F3F6; border-radius: 10px; }
    .seg button { flex: 1; min-height: 32px; border: 0; border-radius: 8px; background: transparent; color: #5B6270;
      font-size: 12px; font-weight: 700; cursor: pointer; }
    .seg button[aria-pressed="true"] { background: #fff; color: #16191F; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
    .stats { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; margin: 10px 0; }
    .stat { background: #F1F3F6; border-radius: 8px; padding: 8px; }
    .stat b { display: block; font-size: 16px; }
    .note { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #FBEFE6; color: #6B2A0E; }
    .ok { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #E7F4EC; color: #1D6B3F; font-weight: 600; }
    .busy { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #EEF1FD; color: #1E34A8; }
    label { display: block; font-weight: 600; margin-top: 10px; }
    input[type=range] { width: 100%; accent-color: #2F4BD8; }
    .scale { display: flex; justify-content: space-between; font-size: 11px; color: #5B6270; }
    ol { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .item { width: 100%; text-align: left; padding: 6px 8px; border-radius: 8px; border: 1px solid #E2E5EA;
      background: #fff; color: #16191F; font-size: 13px; cursor: pointer; }
    .bar { display: block; height: 5px; border-radius: 3px; background: #F1F3F6; margin-top: 4px; }
    .bar span { display: block; height: 5px; border-radius: 3px; background: linear-gradient(90deg,#EE9B4D,#B8461A); }
    .detail { margin-top: 10px; padding: 12px; border-radius: 10px; background: #F6F7F9; }
    .detail ul { margin: 6px 0 0; padding-left: 16px; }
    .kicker { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #5B6270; }
    .big { font-size: 30px; font-weight: 800; color: #B8461A; line-height: 1.1; margin-top: 6px; }
    .minis { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 6px; margin-top: 8px; }
    .mini { background: #fff; border-radius: 8px; padding: 6px; font-size: 11px; color: #5B6270; }
    .mini b { display: block; font-size: 14px; color: #16191F; }
    .expo { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px; margin-top: 8px; }
    .expo > div { background: #EEF1FD; border-radius: 8px; padding: 6px 8px; font-size: 11px; line-height: 1.3; }
    .expo b { display: block; font-size: 18px; color: #2F4BD8; }
  `;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    host.id = "footprints-overlay-host";
    host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${LAYER_CSS}</style><div class="layer" id="fp-layer"></div><div id="fp-panel-slot"></div>`;
    document.documentElement.appendChild(host);
    panel.mount();
  }

  // ── The panel ─────────────────────────────────────────────────────────────
  //
  // Clicks on the panel must not end up in the website's own analytics (the
  // site's Dynatrace RUM records every click on its pages). The panel is
  // therefore an extension page in an iframe: what happens inside it is not
  // visible to the site's scripts. If the iframe cannot be used (outside the
  // extension, as in tests), the panel is drawn on the page instead.

  const EXTENSION = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;

  const panel = {
    mode: null, // "frame" | "inline"
    frame: null,
    ready: false,
    token: "",
    last: null, // last rendered { html }
    mount() {
      const slot = root.getElementById("fp-panel-slot");
      if (EXTENSION) {
        this.mode = "frame";
        this.ready = false;
        this.token = crypto.getRandomValues(new Uint32Array(4)).join("-");
        this.frame = document.createElement("iframe");
        this.frame.className = "panel-frame";
        this.frame.title = "Footprints";
        this.frame.src = `${chrome.runtime.getURL("panel.html")}#${this.token}`;
        slot.appendChild(this.frame);
        // Some sites forbid frames: fall back to the in-page panel.
        setTimeout(() => {
          if (this.mode === "frame" && !this.ready) this.fallback();
        }, 3000);
      } else {
        this.inline(slot);
      }
    },
    inline(slot) {
      this.mode = "inline";
      this.frame = null;
      slot.innerHTML = `<div class="panel-inline"><style>${PANEL_CSS}</style><div id="fp-panel-body"></div></div>`;
      const body = root.getElementById("fp-panel-body");
      body.addEventListener("click", (e) => {
        const t = e.target.closest("[data-act]");
        if (t && !t.matches("input")) onPanel(t.dataset.act, t.dataset.value ?? null);
      });
      body.addEventListener("change", (e) => {
        const t = e.target;
        if (t.id === "fp-detail") onPanel("detail", Number(t.value));
        else if (t.dataset.act) onPanel(t.dataset.act, t.checked);
      });
      if (this.last) this.render(this.last);
    },
    fallback() {
      const slot = root && root.getElementById("fp-panel-slot");
      if (!slot) return;
      slot.innerHTML = "";
      this.inline(slot);
      state.inlineWarning = true;
      render();
    },
    post(message) {
      if (this.frame && this.frame.contentWindow) {
        this.frame.contentWindow.postMessage({ ...message, token: this.token }, chrome.runtime.getURL("").slice(0, -1));
      }
    },
    render(html) {
      this.last = html;
      if (this.mode === "frame") {
        if (this.ready) this.post({ type: "render", css: PANEL_CSS, html });
      } else if (this.mode === "inline") {
        const body = root.getElementById("fp-panel-body");
        if (body) body.innerHTML = html;
      }
    },
    detail(html) {
      if (this.mode === "frame") {
        if (this.ready) this.post({ type: "detail", html });
      } else if (this.mode === "inline") {
        const box = root.getElementById("fp-detail-box");
        if (box) box.innerHTML = html;
      }
    },
    resize(height) {
      if (this.frame) this.frame.style.height = `${Math.min(Math.max(60, height), window.innerHeight - 24)}px`;
    },
  };

  // Messages from the isolated panel. Only the panel's own window is trusted.
  window.addEventListener("message", (event) => {
    if (!panel.frame || event.source !== panel.frame.contentWindow) return;
    const m = event.data;
    if (!m || typeof m.act !== "string") return;
    if (m.act === "ready") {
      panel.ready = true;
      if (panel.last) panel.render(panel.last);
      updateHover();
      return;
    }
    if (m.act === "height") {
      panel.resize(Number(m.value) || 0);
      return;
    }
    onPanel(m.act, m.value);
  });

  function onPanel(act, value) {
    switch (act) {
      case "detail":
        state.detail = Math.min(5, Math.max(1, Number(value) || 1));
        state.hover = null;
        render();
        break;
      case "metric":
        if (value === "share" || value === "seen") state.metric = value;
        render();
        break;
      case "dots":
        state.showDots = !!value;
        render();
        break;
      case "folds":
        state.showFolds = !!value;
        render();
        break;
      case "collapse":
        state.collapsed = true;
        render();
        break;
      case "expand":
        state.collapsed = false;
        render();
        break;
      case "area": {
        const a = state.areas.find((x) => x.key === value);
        if (a) {
          a.el.scrollIntoView({ behavior: "smooth", block: "center" });
          state.hover = { kind: "area", area: a, el: a.el };
          updateHover();
        }
        break;
      }
      case "save":
        saveSnapshot();
        break;
      case "close":
        state.payload = null;
        if (host) host.remove();
        host = null;
        root = null;
        panel.frame = null;
        break;
      default:
    }
  }

  function locate() {
    state.found = [];
    state.missing = [];
    state.byEl = new Map();
    for (const row of state.payload.elements) {
      const el = findElement(row.xpath);
      if (el && el.getClientRects().length > 0) {
        state.found.push({ el, row });
        // Clicks on the bare page background are not an element you can point at.
        if (el !== document.body && el !== document.documentElement) state.byEl.set(el, row);
      } else state.missing.push(row);
    }
    if (state.hover && !document.contains(state.hover.el)) state.hover = null;
  }

  function buildAreas() {
    const total = pageArea();
    const cache = new Map();
    const byEl = new Map();
    const rest = { key: "rest", el: null, clicks: 0, items: [] };
    for (const f of state.found) {
      const chain = areaChain(f.el, total, cache);
      const area = chain.length ? chain[Math.min(state.detail, chain.length) - 1] : null;
      if (!area) {
        rest.clicks += f.row.clicks;
        rest.items.push(f);
        continue;
      }
      if (!byEl.has(area)) byEl.set(area, { key: "", el: area, clicks: 0, items: [] });
      const a = byEl.get(area);
      a.clicks += f.row.clicks;
      a.items.push(f);
    }
    const areas = Array.from(byEl.values());
    const ctx = { total, cache };
    uniqueNames(areas.map((a) => [a, areaName(a.el, ctx, false)]));
    for (const a of areas) a.box = pageBox(a.el);
    areas.forEach((a, i) => (a.key = `a${i}`));
    state.areas = areas;
    state.rest = rest;
  }

  /** Gives each item its name, adding (2), (3)… to repeated names. */
  function uniqueNames(pairs) {
    const seen = new Map();
    for (const [item, base] of pairs) {
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      item.name = n > 1 ? `${base} (${n})` : base;
    }
  }

  // ── Small helpers ─────────────────────────────────────────────────────────

  function pct(n, total) {
    if (!total) return "–";
    const v = Math.min(100, (100 * n) / total);
    return v > 0 && v < 0.1 ? "<0.1%" : `${v.toFixed(v >= 10 ? 0 : 1)}%`;
  }

  function fmt(n) {
    return Number(n).toLocaleString("en-US");
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function heat(ratio) {
    if (ratio >= 0.66) return { bg: "#B8461A", fg: "#fff" };
    if (ratio >= 0.33) return { bg: "#EE9B4D", fg: "#16191F" };
    return { bg: "#F6D9A8", fg: "#16191F" };
  }

  const KINDS = { a: "link", button: "button", input: "field", select: "dropdown", textarea: "text box", img: "image", label: "label" };

  /** What the element says on screen: its label, alt text, or visible text. */
  function ownText(n) {
    return (
      n.getAttribute("aria-label") ||
      n.getAttribute("alt") ||
      n.getAttribute("title") ||
      (n.innerText || "").split("\n").map((s) => s.trim()).find(Boolean) ||
      n.getAttribute("placeholder") ||
      n.getAttribute("value") ||
      ""
    );
  }

  /**
   * A name for an element with no text of its own (typically a product
   * picture): the image's alt text, or the text of the small card around it.
   */
  function nearbyText(el) {
    const img = el.querySelector("img[alt]");
    if (img && img.alt.trim()) return img.alt;
    const b = pageBox(el);
    const pageW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    for (let a = el.parentElement, i = 0; a && a !== document.body && i < 5; a = a.parentElement, i++) {
      const ab = pageBox(a);
      if (ab.h > Math.max(700, b.h * 4) || ab.w > pageW * 0.6) break; // stop before whole sections
      const heading = a.querySelector(HEADINGS);
      const t = (heading && heading.textContent.trim()) || ownText(a);
      if (t) return t;
    }
    return "";
  }

  function elementName(el, fallback) {
    const own = ownText(el);
    const hasPicture = !!el.querySelector("img, picture, svg, video, canvas") || el.localName === "img";
    const kind =
      KINDS[el.localName] ||
      (el.closest("a") ? "link" : el.closest("button") ? "button" : hasPicture ? "image" : "element");
    if (own) return `${clip(own, 40)} (${kind})`;
    const near = nearbyText(el);
    if (near) return `${clip(near, 40)} (${kind})`;
    return fallback && fallback !== "Area" ? fallback : kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  function areaContaining(node) {
    let best = null;
    for (const a of state.areas) {
      if (a.el.contains(node) && (!best || a.box.w * a.box.h < best.box.w * best.box.h)) best = a;
    }
    return best;
  }

  function pageClicks() {
    return state.found.reduce((s, f) => s + f.row.clicks, 0) + state.missing.reduce((s, r) => s + r.clicks, 0);
  }

  // ── Exposure: how many visits scrolled far enough to see something ───────

  /** Share of visits whose deepest point seen is at least `px` from the top. */
  function reachAt(px) {
    const s = state.payload && state.payload.scroll;
    if (!s || !s.visits) return null;
    if (px <= 0) return 1;
    let reached = 0;
    for (const [depth, visits] of s.steps) {
      if (depth >= px) reached += visits;
      else if (depth + s.step > px) reached += (visits * (depth + s.step - px)) / s.step; // partly inside this step
    }
    return Math.min(1, reached / s.visits);
  }

  /** Counted as seen when half of it — or its first 300 px, if taller — came into view. */
  function exposureOf(el) {
    const b = pageBox(el);
    return reachAt(b.y + Math.min(b.h / 2, 300));
  }

  /** Depth (px) that a given share of visits reaches, e.g. 0.5 → half the visits get this far. */
  function depthReachedBy(share) {
    const s = state.payload && state.payload.scroll;
    if (!s || !s.visits) return null;
    let lo = 0;
    let hi = s.steps.length ? s.steps[s.steps.length - 1][0] + s.step : 0;
    if (reachAt(hi) >= share) return hi;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (reachAt(mid) >= share) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  function exposureMinis(seen, clickers) {
    if (seen === null) return "";
    const seenVisits = seen * state.payload.pageVisits;
    const whenSeen = clickers !== null && seenVisits > 0 ? pct(Math.min(clickers, seenVisits), seenVisits) : "–";
    return `<div class="expo">
      <div><span class="muted">Seen by</span><b>${pct(seen, 1)}</b><span class="muted">of visits</span></div>
      ${clickers !== null ? `<div><span class="muted">Clicked by</span><b>${whenSeen}</b><span class="muted">of those who saw it</span></div>` : ""}
    </div>`;
  }

  function hasScroll() {
    const p = state.payload;
    return !!(p && p.scroll && p.scroll.visits);
  }

  /** Value of the chosen metric for an area, 0..1. */
  function metricOf(a, total) {
    if (state.metric === "seen" && hasScroll()) return exposureOf(a.el) || 0;
    return total ? a.clicks / total : 0;
  }

  // ── Hover: point at the page to read its numbers ──────────────────────────
  //
  // Pointing is followed with a passive mouse listener: moving the mouse is
  // not recorded by the site's analytics, and clicks keep working normally.

  function targetAt(x, y) {
    const hit = document.elementsFromPoint(x, y).find((n) => n !== host && !(host && host.contains(n)));
    if (!hit) return null;
    for (let n = hit; n && n !== document.documentElement; n = n.parentElement) {
      const row = state.byEl.get(n);
      if (row) return { kind: "element", el: n, row };
    }
    // Not clicked: name and outline the nearest thing a visitor could click
    // (the logo, a cart icon…), so any element can be inspected.
    const clickable = hit.closest(CLICKABLE);
    if (clickable && clickable !== document.body) return { kind: "blank", el: clickable };
    const area = areaContaining(hit);
    if (area) return { kind: "area", area, el: area.el, hit };
    return { kind: "blank", el: hit };
  }

  function sameTarget(a, b) {
    if (!a || !b) return a === b;
    return a.kind === b.kind && a.el === b.el;
  }

  function detailHtml(t) {
    const p = state.payload;
    const total = pageClicks();
    if (!t) {
      return `<div class="detail muted">Point at anything on the page to see how often it is seen and clicked.</div>`;
    }
    if (t.kind === "element") {
      const area = areaContaining(t.el);
      const perVisit = t.row.visits ? (t.row.clicks / t.row.visits).toFixed(1) : "–";
      return `<div class="detail">
        <div class="kicker">Element</div>
        <strong>${esc(elementName(t.el, t.row.label))}</strong>
        ${area ? `<div class="muted">in ${esc(area.name)}</div>` : ""}
        <div class="big">${pct(t.row.visits, p.pageVisits)}</div>
        <div class="muted">of visits to this page click it</div>
        ${exposureMinis(exposureOf(t.el), t.row.visits)}
        <div class="minis">
          <div class="mini">Visits<b>${fmt(t.row.visits)}</b></div>
          <div class="mini">Clicks<b>${fmt(t.row.clicks)}</b></div>
          <div class="mini">Per visit<b>${perVisit}</b></div>
        </div>
        <div class="muted" style="margin-top:6px">${pct(t.row.clicks, total)} of all clicks on the page.</div></div>`;
    }
    if (t.kind === "area") {
      const a = t.area;
      const top = a.items
        .slice()
        .sort((x, y) => y.row.clicks - x.row.clicks)
        .slice(0, 5)
        .map((f) => `<li>${esc(elementName(f.el, f.row.label))} — ${pct(f.row.visits, p.pageVisits)} of visits</li>`)
        .join("");
      const seen = exposureOf(a.el);
      const per100 =
        seen !== null && seen * p.pageVisits > 0 ? Math.round((100 * a.clicks) / (seen * p.pageVisits)) : null;
      return `<div class="detail">
        <div class="kicker">Area</div>
        <strong>${esc(a.name)}</strong>
        ${seen !== null ? `<div class="big">${pct(seen, 1)}</div><div class="muted">of visits scroll far enough to see it</div>` : ""}
        <div class="minis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="mini">Share of clicks<b>${pct(a.clicks, total)}</b></div>
          <div class="mini">${per100 !== null ? `Clicks per 100 views<b>${fmt(per100)}</b>` : `Clicks<b>${fmt(a.clicks)}</b>`}</div>
        </div>
        <div style="margin-top:8px;font-weight:600">Most clicked inside</div>
        <ul>${top}</ul></div>`;
    }
    const area = areaContaining(t.el);
    return `<div class="detail">
      <div class="kicker">Not clicked</div>
      <strong>${esc(elementName(t.el, ""))}</strong>
      <div class="muted" style="margin-top:4px">Nobody clicked here in this period${area ? `, inside ${esc(area.name)}` : ""}.</div>
      ${exposureMinis(exposureOf(t.el), null)}</div>`;
  }

  /** Updates only the highlight and the detail box (cheap, runs on mouse moves). */
  function updateHover() {
    if (!root) return;
    const t = state.hover;
    const hl = root.getElementById("fp-hl");
    if (hl) {
      if (t && t.el) {
        const b = pageBox(t.el);
        hl.style.cssText = `display:block;left:${b.x - 3}px;top:${b.y - 3}px;width:${b.w + 6}px;height:${b.h + 6}px`;
        hl.className = `hl${t.kind === "area" ? " area-target" : ""}`;
      } else {
        hl.style.display = "none";
      }
    }
    if (!state.collapsed) panel.detail(detailHtml(t));
  }

  let moveFrame = 0;
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!state.payload || moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        const t = targetAt(e.clientX, e.clientY);
        if (!sameTarget(t, state.hover)) {
          state.hover = t;
          updateHover();
        }
      });
    },
    { passive: true },
  );

  // ── Full render (on data, detail or layout changes) ───────────────────────

  function render() {
    if (!state.payload) return;
    ensureHost();
    buildAreas();
    if (state.hover && state.hover.kind === "area") {
      const a = state.areas.find((x) => x.el === state.hover.el);
      state.hover = a ? { ...state.hover, area: a } : null;
    }
    const p = state.payload;
    const areas = state.areas;
    const total = pageClicks();
    const scroll = hasScroll();
    if (!scroll && state.metric === "seen") state.metric = "share";
    const maxMetric = Math.max(1e-9, ...areas.map((a) => metricOf(a, total)));
    const ranked = areas.slice().sort((a, b) => metricOf(b, total) - metricOf(a, total));

    // On the page: one number per area, the chosen metric. No names.
    const areaHtml = areas
      .slice()
      .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
      .map((a) => {
        const r = metricOf(a, total) / maxMetric;
        const c = heat(r);
        const alpha = (0.1 + 0.4 * r).toFixed(2);
        return `<div class="area" style="left:${a.box.x}px;top:${a.box.y}px;width:${a.box.w}px;height:${a.box.h}px;background:rgba(232,116,46,${alpha})">
          <span class="chip" style="background:${c.bg};color:${c.fg}">${pct(metricOf(a, total), 1)}</span></div>`;
      })
      .join("");

    const maxEl = Math.max(1, ...state.found.map((f) => f.row.clicks));
    const dotHtml = state.showDots
      ? state.found
          .filter((f) => f.el !== document.body && f.el !== document.documentElement)
          .sort((a, b) => b.row.clicks - a.row.clicks)
          .slice(0, 80)
          .map((f) => {
            const b = pageBox(f.el);
            const size = 8 + Math.round(14 * Math.sqrt(f.row.clicks / maxEl));
            return `<div class="dot" style="left:${b.x + b.w / 2}px;top:${b.y + b.h / 2}px;width:${size}px;height:${size}px"></div>`;
          })
          .join("")
      : "";

    const pageW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    let foldHtml = "";
    if (scroll && state.showFolds) {
      let lastY = -Infinity;
      let slot = 0;
      foldHtml = [0.75, 0.5, 0.25]
        .map((share) => ({ share, d: depthReachedBy(share) }))
        .filter((l) => l.d !== null && l.d > 0)
        .map((l) => {
          // Lines very close together get their labels side by side.
          slot = l.d - lastY < 26 ? slot + 1 : 0;
          lastY = l.d;
          return `<div class="fold" style="top:${Math.round(l.d)}px;width:${pageW}px">
            <span style="left:${8 + slot * 230}px">${Math.round(l.share * 100)}% of visits see down to here</span></div>`;
        })
        .join("");
    }

    root.getElementById("fp-layer").innerHTML = `${areaHtml}${foldHtml}${dotHtml}<div id="fp-hl" class="hl"></div>`;

    const listHtml = ranked
      .slice(0, 10)
      .map(
        (a) => `<li><button type="button" class="item" data-act="area" data-value="${a.key}">
          <span class="row"><strong>${esc(a.name)}</strong><span>${pct(metricOf(a, total), 1)}</span></span>
          <span class="bar"><span style="width:${Math.max(3, Math.round((100 * metricOf(a, total)) / maxMetric))}%"></span></span></button></li>`,
      )
      .join("");

    panel.render(state.collapsed ? collapsedHtml() : panelHtml({ total, areas, listHtml, scroll }));
    updateHover();
  }

  function collapsedHtml() {
    return `<div class="panel"><div class="row"><span class="brand">Footprints</span>
      <button type="button" class="btn" data-act="expand">Show panel</button></div></div>`;
  }

  function notesHtml(total) {
    const p = state.payload;
    const foundClicks = state.found.reduce((s, f) => s + f.row.clicks, 0);
    const notes = [];
    const looksLikeError = /\b(403|404|500|502|503|forbidden|not found|access denied|unauthori[sz]ed)\b/i.test(
      `${document.title} ${(document.body && document.body.innerText.slice(0, 300)) || ""}`,
    );
    if (state.found.length === 0 && state.missing.length) {
      notes.push(
        looksLikeError
          ? "This page did not load: the website answered with an error (for example “403 Forbidden”). Your browser may not be allowed to reach it — try from the company network or VPN."
          : "None of the clicked elements is on this page. It may be a login page, a different version of the site, or a page that did not finish loading.",
      );
    } else if (state.missing.length) {
      notes.push(
        `${pct(total - foundClicks, total)} of the clicks are on elements that are not on screen now (menus, pop-ups, or content that changed).`,
      );
    }
    if (state.rest && state.rest.clicks) {
      notes.push(`${pct(state.rest.clicks, total)} of the clicks are on empty parts of the page, outside every area.`);
    }
    if (!hasScroll()) {
      notes.push(
        p.scrollError
          ? `How far visitors scroll could not be loaded, so “seen by” is not shown. (${esc(p.scrollError)})`
          : "No scroll data for this page, so “seen by” is not shown.",
      );
    } else if (p.deviceKey === "all") {
      notes.push("“Seen by” mixes desktop and mobile, whose pages have very different lengths. Choose one device in Footprints for exact numbers.");
    }
    const w = window.innerWidth;
    if ((p.deviceKey === "desktop" && w < 1024) || (p.deviceKey === "mobile" && w >= 768) || (p.deviceKey === "tablet" && (w < 768 || w >= 1024))) {
      notes.push(`The data is for ${esc(String(p.device).toLowerCase())}, but this window is ${w}px wide: resize it to see the page as those visitors did.`);
    }
    if (state.inlineWarning) {
      notes.push("This site does not allow the Footprints panel to run separately, so clicks on this panel may appear in the site's own analytics.");
    }
    return notes.map((n) => `<div class="note">${n}</div>`).join("");
  }

  function savingHtml() {
    const s = state.saving;
    if (!s) return "";
    const cls = s.kind === "done" ? "ok" : s.kind === "busy" ? "busy" : "note";
    return `<div class="${cls}" role="status">${esc(s.text)}</div>`;
  }

  function panelHtml({ total, areas, listHtml, scroll }) {
    const p = state.payload;
    const busy = state.saving && state.saving.kind === "busy";
    return `<div class="panel" role="dialog" aria-label="Footprints">
      <div class="row"><span class="brand">Footprints</span>
        <span><button type="button" class="btn" data-act="collapse" aria-label="Minimise panel">–</button>
        <button type="button" class="btn" data-act="close" aria-label="Remove overlay">✕</button></span></div>
      <div class="muted">${esc(p.app || "")} · ${esc(p.period || "")} · ${esc(p.device || "")}</div>
      <button type="button" class="primary" data-act="save" ${busy ? "disabled" : ""}>${busy ? "Saving snapshot…" : "Save snapshot to Footprints"}</button>
      ${savingHtml()}
      ${
        scroll
          ? `<div class="seg" role="group" aria-label="Show on the page">
              <button type="button" data-act="metric" data-value="share" aria-pressed="${state.metric === "share"}">Share of clicks</button>
              <button type="button" data-act="metric" data-value="seen" aria-pressed="${state.metric === "seen"}">Seen by</button>
            </div>`
          : ""
      }
      <div id="fp-detail-box"></div>
      <div class="stats">
        <div class="stat">Clicks on this page<b>${fmt(total)}</b></div>
        <div class="stat">Areas<b>${fmt(areas.length)}</b></div>
      </div>
      <label for="fp-detail">Detail</label>
      <input id="fp-detail" type="range" min="1" max="5" step="1" value="${state.detail}" />
      <div class="scale"><span>Fewer, larger areas</span><span>More, smaller</span></div>
      <label style="font-weight:500"><input type="checkbox" data-act="dots" ${state.showDots ? "checked" : ""}/> Show clicked elements</label>
      ${scroll ? `<label style="font-weight:500;margin-top:4px"><input type="checkbox" data-act="folds" ${state.showFolds ? "checked" : ""}/> Show how far visitors scroll</label>` : ""}
      <ol aria-label="Areas">${listHtml}</ol>
      ${notesHtml(total)}
    </div>`;
  }

  // ── Snapshot: picture of the whole page + map of its areas and elements ───

  const CLICKABLE = "a[href], button, input, select, textarea, label, summary, img, [role=button], [role=link], [role=tab], [onclick], [tabindex]";
  const MAX_ELEMENTS = 3000;
  const MAX_PAGE_HEIGHT = 16000;
  const OUTPUT_WIDTH = 1440;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function round(b) {
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  }

  /** `div[@id="root"]` when the element has an id, otherwise `div[2]` (2nd div among its siblings). */
  function segmentOf(el) {
    if (el.id) return `${el.localName}[@id="${el.id}"]`;
    let n = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === el.localName) n++;
    return `${el.localName}[${n}]`;
  }

  /**
   * Keys the app can match recorded xpaths against: the full path from <html>,
   * and the path from every ancestor that has an id (Dynatrace sometimes starts
   * an xpath at the nearest id, e.g. //*[@id="cart"]/div/div).
   */
  function canonicalKeys(el) {
    const segs = [];
    const keys = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.id && segs.length) keys.push(`#${n.id}/${segs.slice().reverse().join("/")}`);
      if (n.id && !segs.length) keys.push(`#${n.id}`);
      segs.push(n === document.documentElement ? "html[1]" : segmentOf(n));
    }
    keys.unshift(segs.reverse().join("/"));
    return keys;
  }

  function pathOnly(url) {
    try {
      const u = new URL(url, location.href);
      return u.pathname + u.search;
    } catch {
      return "";
    }
  }

  /** What the element shows today: its link target, picture and text. */
  function contentOf(el) {
    const a = el.closest("a[href]");
    const img = el.localName === "img" ? el : el.querySelector("img");
    return {
      href: a ? pathOnly(a.getAttribute("href")) : "",
      src: img && img.currentSrc ? pathOnly(img.currentSrc) : "",
      text: clip(ownText(el), 80),
    };
  }

  function buildMap(pageHeight) {
    const total = pageArea();
    const cache = new Map();
    const ctx = { total, cache };
    const areaIds = new Map();
    const areas = [];
    const areaId = (el) => {
      if (!areaIds.has(el)) {
        const item = { id: `a${areas.length}`, key: canonicalKeys(el)[0], box: round(pageBox(el)) };
        areaIds.set(el, item.id);
        areas.push(item);
        item._el = el;
      }
      return areaIds.get(el);
    };
    const elements = [];
    const byEl = new Map();
    const add = (el, rawKey) => {
      if (el === document.body || el === document.documentElement || (host && host.contains(el))) return;
      const existing = byEl.get(el);
      if (existing) {
        if (rawKey && !existing.keys.includes(rawKey)) existing.keys.unshift(rawKey);
        return;
      }
      if (elements.length >= MAX_ELEMENTS) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const item = {
        keys: rawKey ? [rawKey, ...canonicalKeys(el)] : canonicalKeys(el),
        box: round(pageBox(el)),
        name: elementName(el, ""),
        chain: areaChain(el, total, cache).map(areaId),
        content: contentOf(el),
      };
      byEl.set(el, item);
      elements.push(item);
    };
    for (const f of state.found) add(f.el, JSON.stringify(f.row.xpath));
    for (const el of document.querySelectorAll(CLICKABLE)) add(el, null);
    uniqueNames(areas.map((a) => [a, areaName(a._el, ctx, false)]));
    areas.forEach((a) => delete a._el);
    return {
      areas,
      elements,
      page: { w: document.documentElement.clientWidth, h: pageHeight },
      detail: state.detail,
    };
  }

  function capture() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "footprints:capture" }, (res) => {
        const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : res && res.error;
        if (err || !res || !res.dataUrl) reject(new Error(err || "The browser did not return a picture."));
        else resolve(res.dataUrl);
      });
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the captured picture."));
      img.src = src;
    });
  }

  /** Elements that stay on screen while scrolling (sticky headers, cookie bars…). */
  function fixedElements() {
    const out = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (host && (el === host || host.contains(el))) continue;
      const pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") out.push(el);
    }
    return out;
  }

  /**
   * Scrolls through the page taking one picture per screen and stitches them.
   * The overlay is hidden meanwhile; sticky elements are hidden after the
   * first picture so they do not repeat down the page.
   */
  async function capturePage(onProgress) {
    const doc = document.documentElement;
    const startY = window.scrollY;
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const width = doc.clientWidth;
    host.style.display = "none";
    const hidden = [];
    try {
      // 1. Go through the page once so lazy content loads, then back to the top.
      const fullH = () => Math.min(Math.max(doc.scrollHeight, document.body.scrollHeight), MAX_PAGE_HEIGHT);
      for (let y = 0; y < fullH(); y += Math.round(viewH * 0.8)) {
        window.scrollTo(0, y);
        await wait(150);
      }
      window.scrollTo(0, 0);
      await wait(600);
      const height = fullH();
      const truncated = Math.max(doc.scrollHeight, document.body.scrollHeight) > MAX_PAGE_HEIGHT;
      const map = buildMap(height);

      // 2. One picture per screen. The browser allows about two pictures a second.
      const shots = [];
      const sticky = fixedElements();
      const hide = (el) => {
        hidden.push([el, el.style.getPropertyValue("visibility"), el.style.getPropertyPriority("visibility")]);
        el.style.setProperty("visibility", "hidden", "important");
      };
      // Bars and widgets stuck to the bottom or the sides (cookie banners, chat
      // buttons) would cover the page: hide them from the start. Headers stuck
      // to the top stay in the first picture only.
      const atTop = (el) => el.getBoundingClientRect().top < viewH * 0.25;
      for (const el of sticky) if (!atTop(el)) hide(el);
      for (let y = 0, i = 0; ; i++) {
        window.scrollTo(0, y);
        await wait(600);
        const actualY = Math.round(window.scrollY);
        onProgress(`Taking pictures of the page… ${Math.min(100, Math.round(((actualY + viewH) / height) * 100))}%`);
        shots.push({ y: actualY, dataUrl: await capture() });
        if (i === 0) for (const el of sticky) if (atTop(el)) hide(el);
        if (actualY + viewH >= height - 1 || y + viewH >= height) break;
        y += viewH;
        if (shots.length > 60) break;
      }

      // 3. Stitch.
      onProgress("Putting the pictures together…");
      const scale = Math.min(1, OUTPUT_WIDTH / width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const g = canvas.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (const shot of shots) {
        const img = await loadImage(shot.dataUrl);
        g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, Math.round(shot.y * scale), Math.round(viewW * scale), Math.round(viewH * scale));
      }
      return {
        image: { dataUrl: canvas.toDataURL("image/jpeg", 0.82), width: canvas.width, height: canvas.height, scale },
        map,
        truncated,
      };
    } finally {
      for (const [el, value, priority] of hidden) {
        if (value) el.style.setProperty("visibility", value, priority);
        else el.style.removeProperty("visibility");
      }
      window.scrollTo(0, startY);
      host.style.display = "";
    }
  }

  function setSaving(saving) {
    state.saving = saving;
    render();
  }

  async function saveSnapshot() {
    if (!EXTENSION || (state.saving && state.saving.kind === "busy")) return;
    const p = state.payload;
    setSaving({ kind: "busy", text: "Preparing… please keep this tab open and do not scroll." });
    try {
      const shot = await capturePage((text) => setSaving({ kind: "busy", text }));
      setSaving({ kind: "busy", text: "Sending the snapshot to Footprints…" });
      const snapshot = {
        kind: "footprints-snapshot",
        v: 1,
        app: p.app,
        appId: p.appId || p.app,
        page: p.page,
        url: location.href,
        title: document.title,
        device: window.innerWidth >= 1024 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "mobile",
        viewport: { w: window.innerWidth, h: window.innerHeight },
        capturedAt: new Date().toISOString(),
        truncated: shot.truncated,
        image: shot.image,
        map: shot.map,
        names: {},
      };
      const res = await new Promise((resolve) =>
        chrome.runtime.sendMessage({ type: "footprints:snapshot", snapshot }, (r) =>
          resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || {}),
        ),
      );
      if (res.ok) {
        setSaving({ kind: "done", text: "Snapshot saved. Open it in Footprints to analyse the page." });
      } else if (res.pending) {
        setSaving({
          kind: "pending",
          text: "Footprints is not open any more: the snapshot is kept in this browser and will be added the next time you open Footprints.",
        });
      } else {
        setSaving({ kind: "error", text: `The snapshot could not be saved: ${res.error || "unknown error"}` });
      }
    } catch (err) {
      setSaving({ kind: "error", text: `The snapshot could not be taken: ${err && err.message ? err.message : err}` });
    }
  }

  // ── Keeping up with the page ──────────────────────────────────────────────

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!state.payload || (state.saving && state.saving.kind === "busy")) return;
      locate();
      render();
    }, 600);
  }
  window.addEventListener("resize", schedule);
  new MutationObserver((records) => {
    if (records.every((r) => host && (r.target === host || host.contains(r.target)))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  /**
   * The first detail level where no single area takes more than 75% of the
   * clicks, so the page never opens as one big "Main content" block that says
   * nothing. If no level gets there, the level with the most areas.
   */
  function startingDetail() {
    let best = { detail: 2, count: -1 };
    for (let d = 1; d <= 5; d++) {
      state.detail = d;
      buildAreas();
      const total = state.areas.reduce((s, a) => s + a.clicks, 0);
      const top = Math.max(0, ...state.areas.map((a) => a.clicks));
      if (state.areas.length >= 2 && total > 0 && top / total <= 0.75) return d;
      if (state.areas.length > best.count) best = { detail: d, count: state.areas.length };
    }
    return best.detail;
  }

  function show(payload) {
    state.payload = payload;
    state.hover = null;
    state.saving = null;
    state.metric = "share";
    locate();
    state.detail = startingDetail();
    render();
    // Content often keeps loading after the page is "complete".
    setTimeout(schedule, 1500);
  }

  window.__footprints = {
    show,
    findElement,
    readSegment,
    canonicalKeys,
    targetAt: (x, y) => targetAt(x, y),
    // For tests: the closed shadow root and the in-page panel.
    debug: { root: () => root, panelMode: () => panel.mode, buildMap: () => buildMap(document.documentElement.scrollHeight) },
  };

  if (EXTENSION) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "footprints:render") {
        show(message.payload);
        sendResponse({ ok: true });
      }
    });
  }
})();
