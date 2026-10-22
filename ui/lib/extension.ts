/**
 * Talks to the Footprints browser extension.
 *
 * The extension injects a small bridge into this app's frame. Messages go
 * through window.postMessage, so the extension never needs Dynatrace
 * credentials: the app reads the data, the extension only draws it.
 */
import { useEffect, useRef, useState } from "react";
import type { PageElement, ScrollDepth } from "../hooks/data";
import { isSnapshot, Snapshot } from "./snapshots";

export interface PagePayload {
  kind: "footprints-page";
  v: 1;
  app: string;
  appId: string;
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
  /** Automatic snapshots: the kind of device, the window width, and other widths to measure. */
  capture?: { device: "desktop" | "mobile"; width: number; widths: number[] };
}

interface ExtensionMessage {
  source: "footprints-extension";
  type: "pong" | "shown" | "snapshot" | "auto-progress" | "auto-done";
  version?: string;
  text?: string;
  pct?: number;
  pending?: boolean;
  requestId?: string;
  ok?: boolean;
  error?: string | null;
  deliveryId?: string;
  snapshot?: unknown;
}

/**
 * Receives snapshots taken by the extension and confirms them once `save`
 * has stored them. The extension keeps a snapshot until it is confirmed.
 */
export function useSnapshotInbox(save: (snapshot: Snapshot) => Promise<string>): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const handled = new Set<string>();
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== window || !isExtensionMessage(event.data) || event.data.type !== "snapshot") return;
      const { deliveryId, snapshot } = event.data;
      if (!deliveryId || handled.has(deliveryId)) return;
      handled.add(deliveryId);
      const answer = (ok: boolean, error: string | null, documentId: string | null) =>
        window.postMessage({ source: "footprints-app", type: "snapshot-saved", deliveryId, ok, error, documentId }, "*");
      if (!isSnapshot(snapshot)) {
        answer(false, "This is not a Footprints snapshot.", null);
        return;
      }
      try {
        answer(true, null, await saveRef.current(snapshot));
      } catch (err) {
        handled.delete(deliveryId);
        answer(false, err instanceof Error ? err.message : String(err), null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
}

function isExtensionMessage(data: unknown): data is ExtensionMessage {
  return !!data && typeof data === "object" && (data as { source?: unknown }).source === "footprints-extension";
}

/** The extension's version once it has answered in this frame (null until then). */
export function useExtensionVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === window && isExtensionMessage(event.data) && event.data.type === "pong") setVersion(event.data.version || "0");
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "footprints-app", type: "ping" }, "*");
    const retry = window.setInterval(() => window.postMessage({ source: "footprints-app", type: "ping" }, "*"), 3000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(retry);
    };
  }, []);
  return version;
}

/** True once the extension has answered in this frame. */
export function useExtensionInstalled(): boolean {
  return useExtensionVersion() !== null;
}

/** Version a.b.c is at least min. */
export function versionAtLeast(version: string | null, min: string): boolean {
  if (!version) return false;
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}

/**
 * Asks the extension for an automatic snapshot: the page is loaded in a
 * background tab at the chosen device's width, pictured, measured at other
 * widths, and the snapshot arrives through useSnapshotInbox.
 */
export function takeAutoSnapshot(payload: PagePayload, onProgress: (text: string, pct: number | null) => void, timeoutMs = 240000): Promise<{ pending: boolean }> {
  const requestId = `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The browser extension did not finish the snapshot in time. Try again, or take it “By hand”."));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || !isExtensionMessage(event.data)) return;
      if (event.data.type === "auto-progress" && event.data.text) onProgress(event.data.text, typeof event.data.pct === "number" ? event.data.pct : null);
      if (event.data.type !== "auto-done" || event.data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (event.data.ok) resolve({ pending: false });
      else if (event.data.pending) resolve({ pending: true });
      else reject(new Error(event.data.error || "The browser extension could not take the snapshot."));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "footprints-app", type: "auto-snapshot", requestId, payload }, "*");
  });
}

/**
 * The window widths to use for an automatic snapshot: the most common one
 * for the device, and others until about 90% of clicks are covered (at most 5).
 */
export function planWidths(widths: { width: number; clicks: number }[], device: "desktop" | "mobile"): { main: number; others: number[]; coverage: number } {
  const fits = (w: number) => (device === "desktop" ? w >= 1024 && w <= 3840 : w >= 280 && w < 768);
  const list = widths.filter((w) => fits(w.width)).sort((a, b) => b.clicks - a.clicks);
  const total = list.reduce((s, w) => s + w.clicks, 0);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(16, b * 0.03);
  const picked: number[] = [];
  for (const w of list) {
    if (picked.length >= 5) break;
    if (picked.some((p) => near(w.width, p))) continue;
    picked.push(w.width);
    const covered = list.filter((x) => picked.some((p) => near(x.width, p))).reduce((s, x) => s + x.clicks, 0);
    if (total && covered / total >= 0.9) break;
  }
  const covered = list.filter((x) => picked.some((p) => near(x.width, p))).reduce((s, x) => s + x.clicks, 0);
  const main = picked[0] ?? (device === "desktop" ? 1440 : 390);
  return { main, others: picked.slice(1), coverage: total ? covered / total : 0 };
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
