/**
 * Footprints – bridge between the Footprints Dynatrace app and the extension.
 *
 * Runs inside the Dynatrace app's frame. The app talks to it with
 * window.postMessage; the bridge forwards requests to the extension's
 * background worker. This way the extension never needs Dynatrace
 * credentials: the app reads the data with the user's own login.
 */
(() => {
  const VERSION = chrome.runtime.getManifest().version;

  function reply(message) {
    window.postMessage({ source: "footprints-extension", version: VERSION, ...message }, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "footprints-app") return;

    if (data.type === "ping") {
      reply({ type: "pong" });
      return;
    }

    if (data.type === "show") {
      chrome.runtime.sendMessage({ type: "footprints:open", payload: data.payload }, (response) => {
        const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : response && response.error;
        reply({ type: "shown", requestId: data.requestId, ok: !error && !!(response && response.ok), error: error || null });
      });
    }
  });

  // Announce ourselves in case the app pinged before we were ready.
  reply({ type: "pong" });
})();
