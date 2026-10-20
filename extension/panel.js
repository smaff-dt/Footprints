/**
 * Footprints – the panel shown on the live page.
 *
 * This page runs inside an iframe that the extension adds to the website. Its
 * clicks stay here, out of reach of the website's scripts (and of its
 * analytics). The content script sends the markup to show; the panel sends
 * back what the user does. Messages from anywhere else are ignored: incoming
 * ones must carry the secret token from this page's address, which the
 * website cannot read.
 */
(() => {
  const token = location.hash.slice(1);
  const style = document.getElementById("fp-style");
  const root = document.getElementById("fp-root");

  function send(act, value) {
    window.parent.postMessage({ act, value }, "*");
  }

  function reportHeight() {
    send("height", Math.ceil(document.documentElement.scrollHeight));
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const m = event.data;
    if (!m || !token || m.token !== token) return;
    if (m.type === "render") {
      style.textContent = String(m.css || "");
      root.innerHTML = String(m.html || "");
      reportHeight();
    } else if (m.type === "detail") {
      const box = document.getElementById("fp-detail-box");
      if (box) box.innerHTML = String(m.html || "");
      reportHeight();
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (t && !t.matches("input")) send(t.dataset.act, t.dataset.value ?? null);
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "fp-detail") send("detail", Number(t.value));
    else if (t.dataset && t.dataset.act) send(t.dataset.act, t.checked);
  });

  new ResizeObserver(reportHeight).observe(document.documentElement);
  send("ready", null);
})();
