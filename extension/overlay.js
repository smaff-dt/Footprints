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
 * 3. Colors each area by its share of the page's clicks and lists the most
 *    clicked areas in a side panel.
 *
 * Everything is drawn inside a shadow root so the site's styles cannot
 * interfere, and nothing on the site is changed.
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

  // ── State and rendering ───────────────────────────────────────────────────

  const state = {
    payload: null,
    detail: 2,
    showDots: true,
    collapsed: false,
    hover: null,
    found: [], // { el, row }
    missing: [], // rows not found on the page
  };

  let host = null;
  let root = null;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .layer { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
    .area { position: absolute; border-radius: 6px; border: 2px solid rgba(184,70,26,.75); }
    .area.hot { border: 3px solid #2F4BD8; box-shadow: 0 0 0 4px rgba(47,75,216,.25); }
    .chip { position: absolute; left: 4px; top: 4px; pointer-events: auto; cursor: default;
      display: inline-flex; gap: 6px; align-items: center; max-width: calc(100% - 8px);
      padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; line-height: 1.4;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
    .dot { position: absolute; border-radius: 50%; transform: translate(-50%, -50%);
      background: rgba(47,75,216,.85); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
    .panel { position: fixed; top: 12px; right: 12px; width: 320px; max-height: calc(100vh - 24px); overflow: auto;
      pointer-events: auto; background: #fff; color: #16191F; border: 1px solid #E2E5EA; border-radius: 14px;
      box-shadow: 0 8px 28px rgba(22,25,31,.22); padding: 14px; font-size: 13px; line-height: 1.45; }
    .panel.collapsed { width: auto; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .brand { font-weight: 800; font-size: 15px; }
    .muted { color: #5B6270; }
    .btn { min-height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid #CDD2DA; background: #fff;
      color: #16191F; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn:focus-visible, input:focus-visible { outline: 3px solid #2F4BD8; outline-offset: 2px; }
    .stats { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; margin: 10px 0; }
    .stat { background: #F1F3F6; border-radius: 8px; padding: 8px; }
    .stat b { display: block; font-size: 16px; }
    .note { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #FBEFE6; color: #6B2A0E; }
    label { display: block; font-weight: 600; margin-top: 10px; }
    input[type=range] { width: 100%; accent-color: #2F4BD8; }
    .scale { display: flex; justify-content: space-between; font-size: 11px; color: #5B6270; }
    ol { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    li { padding: 6px 8px; border-radius: 8px; border: 1px solid #E2E5EA; cursor: default; }
    li.hot { border-color: #2F4BD8; background: #EEF1FD; }
    .bar { height: 5px; border-radius: 3px; background: #F1F3F6; margin-top: 4px; }
    .bar span { display: block; height: 5px; border-radius: 3px; background: linear-gradient(90deg,#EE9B4D,#B8461A); }
    .detail { margin-top: 10px; padding: 10px; border-radius: 10px; background: #F6F7F9; }
    .detail ul { margin: 6px 0 0; padding-left: 16px; }
  `;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    host.id = "footprints-overlay-host";
    host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;";
    root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }

  function locate() {
    state.found = [];
    state.missing = [];
    for (const row of state.payload.elements) {
      const el = findElement(row.xpath);
      if (el && el.getClientRects().length > 0) state.found.push({ el, row });
      else state.missing.push(row);
    }
  }

  function buildAreas() {
    const total = pageArea();
    const cache = new Map();
    const byEl = new Map();
    const rest = { key: "rest", el: null, clicks: 0, rows: [] };
    for (const f of state.found) {
      const chain = areaChain(f.el, total, cache);
      const area = chain.length ? chain[Math.min(state.detail, chain.length) - 1] : null;
      if (!area) {
        rest.clicks += f.row.clicks;
        rest.rows.push(f.row);
        continue;
      }
      if (!byEl.has(area)) byEl.set(area, { key: "", el: area, clicks: 0, rows: [] });
      const a = byEl.get(area);
      a.clicks += f.row.clicks;
      a.rows.push(f.row);
    }
    const areas = Array.from(byEl.values());
    // Readable, unique names
    const seen = new Map();
    const ctx = { total, cache };
    for (const a of areas) {
      let name = areaName(a.el, ctx, false);
      const n = (seen.get(name) || 0) + 1;
      seen.set(name, n);
      if (n > 1) name = `${name} (${n})`;
      a.name = name;
      a.box = pageBox(a.el);
    }
    areas.forEach((a, i) => (a.key = `a${i}`));
    return { areas, rest };
  }

  function pct(n, total) {
    if (!total) return "0%";
    const v = (100 * n) / total;
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

  function render() {
    if (!state.payload) return;
    ensureHost();
    const p = state.payload;
    const { areas, rest } = buildAreas();
    const pageClicks = state.found.reduce((s, f) => s + f.row.clicks, 0) + state.missing.reduce((s, r) => s + r.clicks, 0);
    const maxClicks = Math.max(1, ...areas.map((a) => a.clicks));
    const ranked = areas.slice().sort((a, b) => b.clicks - a.clicks);
    const hot = areas.find((a) => a.key === state.hover) || null;

    const areaHtml = areas
      .slice()
      .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
      .map((a) => {
        const r = a.clicks / maxClicks;
        const c = heat(r);
        const alpha = (0.1 + 0.4 * r).toFixed(2);
        return `<div class="area ${a.key === state.hover ? "hot" : ""}" style="left:${a.box.x}px;top:${a.box.y}px;width:${a.box.w}px;height:${a.box.h}px;background:rgba(232,116,46,${alpha})">
          <span class="chip" data-area="${a.key}" style="background:${c.bg};color:${c.fg}">${esc(a.name)} · ${pct(a.clicks, pageClicks)}</span></div>`;
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
            return `<div class="dot" title="${esc(f.row.label)}: ${fmt(f.row.clicks)} clicks" style="left:${b.x + b.w / 2}px;top:${b.y + b.h / 2}px;width:${size}px;height:${size}px"></div>`;
          })
          .join("")
      : "";

    const listHtml = ranked
      .slice(0, 10)
      .map(
        (a) => `<li class="${a.key === state.hover ? "hot" : ""}" data-area="${a.key}">
          <div class="row"><strong>${esc(a.name)}</strong><span>${pct(a.clicks, pageClicks)}</span></div>
          <div class="bar"><span style="width:${Math.max(3, Math.round((100 * a.clicks) / maxClicks))}%"></span></div></li>`,
      )
      .join("");

    const detailHtml = hot
      ? `<div class="detail"><strong>${esc(hot.name)}</strong>
          <div>${fmt(hot.clicks)} clicks · ${pct(hot.clicks, pageClicks)} of the page's clicks</div>
          <ul>${hot.rows
            .slice()
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 5)
            .map((r) => `<li style="border:0;padding:0">${esc(r.label)} — ${fmt(r.clicks)} clicks, ${fmt(r.visits)} visits</li>`)
            .join("")}</ul></div>`
      : `<div class="detail muted">Point at an area to see what is clicked inside it.</div>`;

    const foundClicks = state.found.reduce((s, f) => s + f.row.clicks, 0);
    const notes = [];
    if (state.missing.length) {
      notes.push(
        `${pct(pageClicks - foundClicks, pageClicks)} of the clicks are on elements that are not on screen now (menus, pop-ups, or content that changed).`,
      );
    }
    if (rest.clicks) {
      notes.push(`${pct(rest.clicks, pageClicks)} of the clicks are on empty parts of the page, outside every area.`);
    }
    const w = window.innerWidth;
    if ((p.deviceKey === "desktop" && w < 1024) || (p.deviceKey === "mobile" && w >= 768) || (p.deviceKey === "tablet" && (w < 768 || w >= 1024))) {
      notes.push(`The data is for ${esc(p.device.toLowerCase())}, but this window is ${w}px wide: resize it to see the page as those visitors did.`);
    }

    const panelHtml = state.collapsed
      ? `<div class="panel collapsed"><div class="row"><span class="brand">Footprints</span><button class="btn" data-act="expand">Show panel</button></div></div>`
      : `<div class="panel">
          <div class="row"><span class="brand">Footprints</span>
            <span><button class="btn" data-act="collapse" aria-label="Minimise panel">–</button>
            <button class="btn" data-act="close" aria-label="Remove overlay">✕</button></span></div>
          <div class="muted">${esc(p.app || "")} · ${esc(p.period || "")} · ${esc(p.device || "")}</div>
          <div class="stats">
            <div class="stat">Clicks on this page<b>${fmt(pageClicks)}</b></div>
            <div class="stat">Areas<b>${fmt(areas.length)}</b></div>
          </div>
          <label for="fp-detail">Detail</label>
          <input id="fp-detail" type="range" min="1" max="5" step="1" value="${state.detail}" />
          <div class="scale"><span>Fewer, larger areas</span><span>More, smaller</span></div>
          <label style="font-weight:500"><input type="checkbox" data-act="dots" ${state.showDots ? "checked" : ""}/> Show clicked elements</label>
          <ol>${listHtml}</ol>
          ${detailHtml}
          ${notes.map((n) => `<div class="note">${n}</div>`).join("")}
        </div>`;

    root.innerHTML = `<style>${CSS}</style><div class="layer">${areaHtml}${dotHtml}</div>${panelHtml}`;
    wire();
  }

  function wire() {
    root.querySelectorAll("[data-area]").forEach((n) => {
      n.addEventListener("mouseenter", () => {
        if (state.hover !== n.dataset.area) {
          state.hover = n.dataset.area;
          render();
        }
      });
    });
    const slider = root.getElementById("fp-detail");
    if (slider) {
      slider.addEventListener("change", () => {
        state.detail = Number(slider.value);
        state.hover = null;
        render();
        const s = root.getElementById("fp-detail");
        if (s) s.focus();
      });
    }
    const act = (name, fn) => root.querySelectorAll(`[data-act="${name}"]`).forEach((n) => n.addEventListener("click", fn));
    const dots = root.querySelector('[data-act="dots"]');
    if (dots) dots.addEventListener("change", () => ((state.showDots = dots.checked), render()));
    act("collapse", () => ((state.collapsed = true), render()));
    act("expand", () => ((state.collapsed = false), render()));
    act("close", () => {
      state.payload = null;
      if (host) host.remove();
      host = null;
    });
  }

  // Redraw when the page layout changes (resizes, late-loading content).
  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!state.payload) return;
      locate();
      render();
    }, 600);
  }
  window.addEventListener("resize", schedule);
  new MutationObserver((records) => {
    if (records.every((r) => host && (r.target === host || host.contains(r.target)))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  function show(payload) {
    state.payload = payload;
    state.hover = null;
    locate();
    render();
    // Content often keeps loading after the page is "complete".
    setTimeout(schedule, 1500);
  }

  window.__footprints = { show, findElement, readSegment };

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "footprints:render") {
        show(message.payload);
        sendResponse({ ok: true });
      }
    });
  }
})();
