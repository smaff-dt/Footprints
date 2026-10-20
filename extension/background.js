/**
 * Footprints – background worker.
 *
 * - Opens a page for the Footprints app and draws the overlay on it once it
 *   has loaded (the data is kept per tab, so a reload draws it again).
 * - Takes the pictures the overlay needs for a snapshot.
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
  const tab = await chrome.tabs.create({ url: payload.url, active: true });
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
  if (!snapshot || snapshot.kind !== "footprints-snapshot") throw new Error("This is not a Footprints snapshot.");
  const deliveryId = newId();
  const stored = sender.tab ? await chrome.storage.session.get(OPENER(sender.tab.id)) : {};
  const opener = sender.tab ? stored[OPENER(sender.tab.id)] : null;
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
