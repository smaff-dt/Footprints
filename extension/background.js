/**
 * Footprints – background worker.
 *
 * - Opens a page for the Footprints app and draws the overlay on it once it
 *   has loaded (the data is kept per tab, so a reload draws it again).
 * - Takes the pictures the overlay needs for a snapshot.
 * - Takes automatic snapshots: loads the page in a background tab at a
 *   desktop or mobile width (through Chrome's debugging interface, which also
 *   gives a full-page picture), and measures where the clicked elements are
 *   at the widths visitors use most.
 * - Delivers snapshots back to the Footprints tab that opened the page. If
 *   that tab is gone, the snapshot is kept and delivered the next time
 *   Footprints is opened.
 */

const PAGE = (tabId) => `tab:${tabId}`;
const OPENER = (tabId) => `opener:${tabId}`;
const PENDING = "pending-snapshots";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;
  const handlers = {
    "footprints:open": () => openWithOverlay(message.payload, sender),
    "footprints:auto": () => autoSnapshot(message.payload, sender),
    "footprints:draw-on-tab": () => drawFromPopup(message.tabId, message.payload),
    "footprints:capture": () => captureVisible(sender),
    "footprints:snapshot": () => deliverSnapshot(message.snapshot, sender),
    "footprints:pending": () => takePending(),
    "footprints:pending-done": () => removePending(message.deliveryId),
  };
  const handler = handlers[message.type];
  if (!handler) return false;
  handler()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err), ...(err && err.extra) }));
  return true; // async response
});

async function openWithOverlay(payload, sender) {
  if (!payload || typeof payload.url !== "string" || !/^https?:\/\//i.test(payload.url)) {
    throw new Error("The page address is missing or is not a web address.");
  }
  if (!Array.isArray(payload.elements)) throw new Error("No click data was received.");
  // Open next to Footprints, in the same window (also when that is an incognito window).
  const tab = await chrome.tabs.create({ url: payload.url, active: true, ...(sender.tab ? { windowId: sender.tab.windowId } : {}) });
  await chrome.storage.session.set({
    [PAGE(tab.id)]: payload,
    [OPENER(tab.id)]: sender.tab ? { tabId: sender.tab.id, frameId: sender.frameId || 0 } : null,
  });
  return {};
}

/** Draws the overlay on a tab. */
async function drawOn(tabId, payload) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] });
  await chrome.tabs.sendMessage(tabId, { type: "footprints:render", payload });
}

async function drawFromPopup(tabId, payload) {
  await chrome.storage.session.set({ [PAGE(tabId)]: payload });
  await drawOn(tabId, payload);
  return {};
}

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const stored = await chrome.storage.session.get(PAGE(tabId));
  const payload = stored[PAGE(tabId)];
  if (!payload) return;
  try {
    await drawOn(tabId, payload);
  } catch (err) {
    console.warn("[Footprints] could not draw the overlay:", err);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([PAGE(tabId), OPENER(tabId)]);
});

/** A picture of what the tab shows right now. */
async function captureVisible(sender) {
  if (!sender.tab) throw new Error("No tab to take a picture of.");
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 85 });
  return { dataUrl };
}

// ── Snapshot delivery ─────────────────────────────────────────────────────

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function deliverSnapshot(snapshot, sender) {
  const stored = sender.tab ? await chrome.storage.session.get(OPENER(sender.tab.id)) : {};
  const opener = sender.tab ? stored[OPENER(sender.tab.id)] : null;
  return deliverTo(opener, snapshot);
}

async function deliverTo(opener, snapshot) {
  if (!snapshot || snapshot.kind !== "footprints-snapshot") throw new Error("This is not a Footprints snapshot.");
  const deliveryId = newId();
  if (opener) {
    try {
      const res = await chrome.tabs.sendMessage(
        opener.tabId,
        { type: "footprints:deliver-snapshot", snapshot, deliveryId },
        { frameId: opener.frameId },
      );
      if (res && res.ok) return { documentId: res.documentId || null };
      if (res && res.error) {
        const err = new Error(res.error);
        throw err;
      }
    } catch (err) {
      // The Footprints tab is closed or did not answer: keep the snapshot for later,
      // unless the app itself refused it.
      if (err && err.message && !/Receiving end does not exist|message port closed|No tab with id|did not answer/i.test(err.message)) {
        throw err;
      }
    }
  }
  await keepPending({ deliveryId, snapshot });
  const err = new Error("Footprints is not open.");
  err.extra = { pending: true };
  throw err;
}

async function keepPending(entry) {
  const stored = await chrome.storage.local.get(PENDING);
  const list = stored[PENDING] || [];
  list.push(entry);
  await chrome.storage.local.set({ [PENDING]: list.slice(-10) });
}

async function takePending() {
  const stored = await chrome.storage.local.get(PENDING);
  return { pending: stored[PENDING] || [] };
}

async function removePending(deliveryId) {
  const stored = await chrome.storage.local.get(PENDING);
  const list = (stored[PENDING] || []).filter((e) => e.deliveryId !== deliveryId);
  await chrome.storage.local.set({ [PENDING]: list });
  return {};
}

// ── Automatic snapshots ───────────────────────────────────────────────────

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tells the Footprints app how far the snapshot is: a short text and a percentage. */
function progress(opener, text, pct) {
  if (!opener) return;
  chrome.tabs.sendMessage(opener.tabId, { type: "footprints:auto-progress", text, pct: Math.round(pct) }, { frameId: opener.frameId }).catch(() => {});
}

async function waitForLoad(tabId, timeoutMs, onTick) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (onTick) onTick((Date.now() - start) / timeoutMs);
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && tab.url && !tab.url.startsWith("about:")) return;
    await sleep(300);
  }
  throw new Error("The page took too long to load.");
}

/** Runs a function of the overlay's automatic API in the tab and returns its result. */
async function inTab(tabId, name, arg) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (fn, a) => {
      try {
        return { ok: true, value: await window.__footprints.auto[fn](a) };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    },
    args: [name, arg === undefined ? null : arg],
  });
  if (!res || !res.result) throw new Error("The page did not answer.");
  if (!res.result.ok) throw new Error(res.result.error);
  return res.result.value;
}

/**
 * payload.capture = { device: "desktop" | "mobile", width, height, widths: [numbers] }
 * widths: other window widths visitors use, where the clicked elements are measured.
 */
async function autoSnapshot(payload, sender) {
  if (!payload || typeof payload.url !== "string" || !/^https?:\/\//i.test(payload.url)) {
    throw new Error("The page address is missing or is not a web address.");
  }
  const cap = payload.capture || {};
  const mobile = cap.device === "mobile";
  const width = Math.round(cap.width || (mobile ? 390 : 1440));
  const height = Math.round(cap.height || (mobile ? 844 : 900));
  const opener = sender.tab ? { tabId: sender.tab.id, frameId: sender.frameId || 0 } : null;

  progress(opener, "Opening the page in the background…", 2);
  const tab = await chrome.tabs.create({ url: "about:blank", active: false, ...(sender.tab ? { windowId: sender.tab.windowId } : {}) });
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const send = (method, params) => chrome.debugger.sendCommand(target, method, params || {});
    const metrics = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await send("Page.enable");
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    if (mobile) {
      await send("Emulation.setUserAgentOverride", { userAgent: IPHONE_UA, platform: "iPhone" });
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
    await metrics(width, height);
    await send("Page.navigate", { url: payload.url });
    // While the page loads, the bar moves slowly so it never looks stuck.
    await waitForLoad(tab.id, 45000, (t) => progress(opener, "Opening the page in the background…", 3 + 10 * Math.min(1, t * 4)));
    progress(opener, "Waiting for the page to settle…", 14);
    // Chrome remembers a zoom level per site (Cmd/Ctrl + / -): show this tab at
    // 100% without changing the zoom the user chose for the site.
    try {
      await chrome.tabs.setZoomSettings(tab.id, { mode: "automatic", scope: "per-tab" });
      await chrome.tabs.setZoom(tab.id, 1);
    } catch (err) {
      console.warn("[Footprints] could not reset the zoom:", err);
    }
    await sleep(2500); // content often keeps loading after "complete"

    progress(opener, "Reading the page…", 18);
    await chrome.scripting.executeScript({ target, files: ["overlay.js"] });
    await inTab(tab.id, "prepare", payload);
    // Pictures. A hidden tab barely draws: pictures that load when they come
    // into view, fade in, or are large wait for a drawing that never comes.
    // So: ask for every picture now; make the whole page "on screen" for a
    // moment and force a few drawings; go through it screen by screen, forcing
    // a drawing at each; then wait until every picture is loaded and ready.
    progress(opener, "Loading the pictures…", 20);
    const draw = () => send("Page.captureScreenshot", { format: "jpeg", quality: 10, clip: { x: 0, y: 0, width: 10, height: 10, scale: 0.1 } }).catch(() => null);
    await inTab(tab.id, "forceImages");
    let size = await inTab(tab.id, "size");
    await metrics(width, Math.max(height, Math.min(size.h, 16000)));
    for (let k = 0; k < 3; k++) {
      await draw();
      await sleep(600);
    }
    await metrics(width, height);
    await sleep(300);
    size = await inTab(tab.id, "size");
    for (let y = 0; y < size.h; y += Math.round(height * 0.8)) {
      progress(opener, "Loading the pictures…", 24 + 20 * (y / size.h));
      await inTab(tab.id, "scrollTo", y);
      await draw();
      await sleep(250);
      await draw();
    }
    await inTab(tab.id, "scrollTo", 0);
    await inTab(tab.id, "forceImages");
    progress(opener, "Waiting for the pictures to be ready…", 45);
    await inTab(tab.id, "imagesReady", false);
    await draw();
    size = await inTab(tab.id, "size");
    await inTab(tab.id, "prepare", payload);

    progress(opener, "Taking the picture…", 50);
    await inTab(tab.id, "hideFloating");
    const map = await inTab(tab.id, "map");
    size = await inTab(tab.id, "size");
    // One picture per screen, scrolling down the page, stitched together. The
    // window keeps its size, so the page looks exactly as when the map was
    // measured (a full-page picture would stretch the window, and some pages
    // change their layout when it does).
    const dpr = mobile ? 2 : 1;
    const scale = mobile && size.h * 2 <= 16000 ? 2 : 1; // phone pictures at twice the size, unless very long
    const shots = [];
    for (let y = 0, i = 0; i < 60; i++) {
      const at = await inTab(tab.id, "scrollTo", y);
      await draw();
      await inTab(tab.id, "imagesReady", true);
      await draw();
      await sleep(200);
      progress(opener, "Taking the picture…", 50 + 30 * Math.min(1, (at.y + at.viewH) / size.h));
      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
      shots.push({ y: at.y, viewW: at.viewW, data: shot.data });
      if (i === 0) await inTab(tab.id, "hideTop");
      if (at.y + at.viewH >= size.h - 1) break;
      y = at.y + at.viewH;
    }
    await inTab(tab.id, "scrollTo", 0);
    await inTab(tab.id, "restoreFloating");
    progress(opener, "Putting the pictures together…", 82);
    const imageData = await stitch(shots, size, dpr, scale);
    // Where the clicked elements are at the widths visitors use.
    const layouts = [await inTab(tab.id, "measure")];
    const others = (cap.widths || []).filter((w) => Math.abs(w - width) > Math.max(8, width * 0.01)).slice(0, 6);
    for (const [i, w] of others.entries()) {
      progress(opener, `Measuring the page at ${w} px (${i + 1} of ${others.length})…`, 85 + (10 * i) / others.length);
      await metrics(Math.round(w), height);
      await sleep(900);
      layouts.push(await inTab(tab.id, "measure"));
    }

    const snapshot = {
      kind: "footprints-snapshot",
      v: 1,
      app: payload.app,
      appId: payload.appId || payload.app,
      page: payload.page,
      url: size.url,
      title: size.title,
      device: mobile ? "mobile" : "desktop",
      viewport: { w: width, h: height },
      capturedAt: new Date().toISOString(),
      truncated: size.truncated,
      image: { dataUrl: imageData, width: Math.round(size.w * scale), height: Math.round(size.h * scale), scale },
      map,
      layouts,
      capture: "auto",
      names: {},
    };
    progress(opener, "Saving the snapshot…", 97);
    const delivered = await deliverTo(opener, snapshot);
    return { ...delivered, layouts: layouts.length };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Joins screen pictures into one page picture at `scale` (picture pixels per
 * page pixel), as a JPEG data URL. How many picture pixels a page pixel takes
 * in each screen picture is measured, not assumed, so a zoom level or screen
 * density cannot shift the picture against the map.
 */
async function stitch(shots, size, _dpr, scale) {
  const canvas = new OffscreenCanvas(Math.round(size.w * scale), Math.round(size.h * scale));
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (const shot of shots) {
    const blob = await (await fetch(`data:image/jpeg;base64,${shot.data}`)).blob();
    const bmp = await createImageBitmap(blob);
    const px = shot.viewW ? bmp.width / shot.viewW : _dpr; // picture pixels per page pixel in this shot
    // Leave out the scrollbar: the page is size.w wide.
    const srcW = Math.min(bmp.width, Math.round(size.w * px));
    const k = scale / px;
    g.drawImage(bmp, 0, 0, srcW, bmp.height, 0, Math.round(shot.y * scale), Math.round(srcW * k), Math.round(bmp.height * k));
    bmp.close();
  }
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}
