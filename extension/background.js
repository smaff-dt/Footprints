/**
 * Footprints – background worker.
 *
 * Opens the requested page in a new tab and, once it has loaded, draws the
 * overlay on it with the data received from the Footprints app. The data is
 * kept per tab (session storage), so reloading the tab draws it again.
 */

const KEY = (tabId) => `tab:${tabId}`;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "footprints:open") return false;
  openWithOverlay(message.payload)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
  return true; // async response
});

async function openWithOverlay(payload) {
  if (!payload || typeof payload.url !== "string" || !/^https?:\/\//i.test(payload.url)) {
    throw new Error("The page address is missing or is not a web address.");
  }
  if (!Array.isArray(payload.elements)) throw new Error("No click data was received.");
  const tab = await chrome.tabs.create({ url: payload.url, active: true });
  await chrome.storage.session.set({ [KEY(tab.id)]: payload });
}

/** Draws the overlay on a tab (also used by the popup's "paste data" fallback). */
async function drawOn(tabId, payload) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] });
  await chrome.tabs.sendMessage(tabId, { type: "footprints:render", payload });
}

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const stored = await chrome.storage.session.get(KEY(tabId));
  const payload = stored[KEY(tabId)];
  if (!payload) return;
  try {
    await drawOn(tabId, payload);
  } catch (err) {
    console.warn("[Footprints] could not draw the overlay:", err);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(KEY(tabId));
});

// Used by popup.js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "footprints:draw-on-tab") return false;
  chrome.storage.session
    .set({ [KEY(message.tabId)]: message.payload })
    .then(() => drawOn(message.tabId, message.payload))
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
  return true;
});
