/**
 * Footprints – bridge between the Footprints Dynatrace app and the extension.
 *
 * Runs inside the Dynatrace app's frame. The app talks to it with
 * window.postMessage; the bridge forwards requests to the extension's
 * background worker, and delivers snapshots from the extension to the app.
 * The extension never needs Dynatrace credentials: the app reads and saves
 * data with the user's own login.
 */
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const SNAPSHOT_TIMEOUT = 120000;

  function reply(message) {
    window.postMessage({ source: "footprints-extension", version: VERSION, ...message }, "*");
  }

  function background(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(response || { ok: false, error: "No answer from the extension." });
        });
      } catch (err) {
        // After the extension is updated or reloaded, bridges in tabs that were
        // already open are cut off from it until the tab is reloaded.
        resolve({ ok: false, error: "The Footprints extension was updated. Reload this page (Cmd/Ctrl + R) and try again." });
      }
    });
  }

  // Snapshots waiting for the app to confirm they are saved: deliveryId -> callback
  const waiting = new Map();

  /** Hands a snapshot to the app and waits until the app has saved it. */
  function handToApp(snapshot, deliveryId) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(deliveryId);
        resolve({ ok: false, error: "Footprints did not answer." });
      }, SNAPSHOT_TIMEOUT);
      waiting.set(deliveryId, (result) => {
        clearTimeout(timer);
        waiting.delete(deliveryId);
        resolve(result);
      });
      reply({ type: "snapshot", deliveryId, snapshot });
    });
  }

  let pendingChecked = false;
  async function deliverPending() {
    if (pendingChecked) return;
    pendingChecked = true;
    const res = await background({ type: "footprints:pending" });
    for (const entry of (res && res.pending) || []) {
      const result = await handToApp(entry.snapshot, entry.deliveryId);
      if (result.ok) await background({ type: "footprints:pending-done", deliveryId: entry.deliveryId });
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "footprints-app") return;

    if (data.type === "ping") {
      reply({ type: "pong" });
      deliverPending();
      return;
    }

    if (data.type === "show") {
      const res = await background({ type: "footprints:open", payload: data.payload });
      reply({ type: "shown", requestId: data.requestId, ok: !!res.ok, error: res.ok ? null : res.error || null });
      return;
    }

    if (data.type === "auto-snapshot") {
      const res = await background({ type: "footprints:auto", payload: data.payload });
      reply({ type: "auto-done", requestId: data.requestId, ok: !!res.ok, pending: !!res.pending, error: res.ok ? null : res.error || null });
      return;
    }

    if (data.type === "snapshot-saved" && waiting.has(data.deliveryId)) {
      waiting.get(data.deliveryId)({ ok: !!data.ok, error: data.error || null, documentId: data.documentId || null });
    }
  });

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "footprints:auto-progress") {
        reply({ type: "auto-progress", text: message.text, pct: message.pct });
        return false;
      }
      if (!message || message.type !== "footprints:deliver-snapshot") return false;
      handToApp(message.snapshot, message.deliveryId).then(sendResponse);
      return true;
    });
  } catch {
    // Extension context gone; nothing to listen to.
  }

  // Announce ourselves in case the app pinged before we were ready.
  reply({ type: "pong" });
})();
