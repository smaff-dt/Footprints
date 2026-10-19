const status = document.getElementById("status");

function say(text, isError) {
  status.textContent = text;
  status.className = isError ? "error" : "";
}

document.getElementById("paste").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      say("The clipboard does not contain Footprints data. Click “Copy page data” in the app first.", true);
      return;
    }
    if (!payload || payload.kind !== "footprints-page" || !Array.isArray(payload.elements)) {
      say("The clipboard does not contain Footprints data. Click “Copy page data” in the app first.", true);
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/i.test(tab.url || "")) {
      say("Open the web page first, then try again.", true);
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: "footprints:draw-on-tab", tabId: tab.id, payload });
    if (res && res.ok) {
      say("Done.");
      window.close();
    } else {
      say(`Could not draw on this page: ${(res && res.error) || "unknown error"}`, true);
    }
  } catch (err) {
    say(`Could not read the clipboard: ${err && err.message ? err.message : err}`, true);
  }
});
