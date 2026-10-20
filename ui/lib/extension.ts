/**
 * Talks to the Footprints browser extension.
 *
 * The extension injects a small bridge into this app's frame. Messages go
 * through window.postMessage, so the extension never needs Dynatrace
 * credentials: the app reads the data, the extension only draws it.
 */
import { useEffect, useState } from "react";
import type { PageElement, ScrollDepth } from "../hooks/data";

export interface PagePayload {
  kind: "footprints-page";
  v: 1;
  app: string;
  page: string;
  url: string;
  period: string;
  device: string;
  deviceKey: string;
  pageVisits: number;
  elements: PageElement[];
  /** How far down the page visits got; null when not available. */
  scroll: ScrollDepth | null;
  /** Why scroll depth is missing, when its query failed. */
  scrollError: string | null;
}

interface ExtensionMessage {
  source: "footprints-extension";
  type: "pong" | "shown";
  requestId?: string;
  ok?: boolean;
  error?: string | null;
}

function isExtensionMessage(data: unknown): data is ExtensionMessage {
  return !!data && typeof data === "object" && (data as { source?: unknown }).source === "footprints-extension";
}

/** True once the extension has answered in this frame. */
export function useExtensionInstalled(): boolean {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === window && isExtensionMessage(event.data) && event.data.type === "pong") setInstalled(true);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "footprints-app", type: "ping" }, "*");
    const retry = window.setInterval(() => window.postMessage({ source: "footprints-app", type: "ping" }, "*"), 3000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(retry);
    };
  }, []);
  return installed;
}

/** Asks the extension to open the page and draw the clicks on it. */
export function showOnPage(payload: PagePayload, timeoutMs = 8000): Promise<void> {
  const requestId = `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The browser extension did not answer. If you just installed or updated it, reload this page (Cmd/Ctrl + R) and try again."));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || !isExtensionMessage(event.data)) return;
      if (event.data.type !== "shown" || event.data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (event.data.ok) resolve();
      else reject(new Error(event.data.error || "The browser extension could not open the page."));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "footprints-app", type: "show", requestId, payload }, "*");
  });
}

/** Fallback when the extension cannot be reached from the app. */
export async function copyPayload(payload: PagePayload): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
