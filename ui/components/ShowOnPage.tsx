/**
 * Taking a snapshot of the page, through the Footprints browser extension:
 * - Desktop / Mobile: automatic, in a background tab, at the window width
 *   visitors use most, measured at the other common widths too;
 * - By hand: the live page opens with the clicks drawn on it, to
 *   arrange it by hand (cookies, menus, window size) and save a snapshot.
 */
import { ReactNode, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressBar } from "@dynatrace/strato-components/content";
import { DesktopIcon, ExternalLinkIcon, MobileIcon } from "@dynatrace/strato-icons";
import { Filters, PageScope } from "../dql/queries";
import { loadClickWidths, loadPageElements, loadPageVisits, loadScrollDepth } from "../hooks/data";
import { formatInt } from "../lib/format";
import { copyPayload, PagePayload, planWidths, showOnPage, takeAutoSnapshot, useExtensionVersion, versionAtLeast } from "../lib/extension";
import { usePersistentState } from "../lib/storage";
import { c } from "../theme";

type Capture = "desktop" | "mobile" | "custom";

const CAPTURE_OPTIONS: { value: Capture; label: string; detail: string; icon: ReactNode }[] = [
  { value: "desktop", label: "Desktop", detail: "Automatic, in the background, at the window width most desktop visitors use.", icon: <DesktopIcon /> },
  { value: "mobile", label: "Mobile", detail: "Automatic, as a phone, at the screen width most mobile visitors use.", icon: <MobileIcon /> },
  { value: "custom", label: "By hand", detail: "Opens the page so you can close pop-ups, log in or resize the window first.", icon: <ExternalLinkIcon /> },
];

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "auto"; device: "desktop" | "mobile"; text: string; pct: number }
  | { kind: "auto-done"; device: "desktop" | "mobile"; pending: boolean }
  | { kind: "opened" }
  | { kind: "problem"; message: string; payload: PagePayload | null }
  | { kind: "copied" }
  | { kind: "manual"; text: string };

export function ShowOnPage(props: {
  filters: Filters;
  /** The page or group key, stored with snapshots. */
  page: string;
  /** The page, or the rules of the group. */
  scope: PageScope;
  sampleUrl: string;
  appName: string;
}) {
  const version = useExtensionVersion();
  const installed = version !== null;
  /** Snapshots need this version of the extension (it records every block of the page and fixes zoom). */
  const NEEDED = "0.5.2";
  const upToDate = versionAtLeast(version, NEEDED);
  const updateMessage = `The Footprints extension needs an update (version ${NEEDED} or later; this browser has ${version}): open chrome://extensions, click ↻ on Footprints, then reload this page.`;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [storedHow, setHow] = usePersistentState<Capture>("fp.capture", "desktop");
  const how: Capture = CAPTURE_OPTIONS.some((o) => o.value === storedHow) ? storedHow : "desktop";

  async function build(filters: Filters = props.filters): Promise<PagePayload> {
    // Scroll depth is a plus: if it fails, the page still shows the clicks.
    const [elements, visits, scroll] = await Promise.all([
      loadPageElements(filters, props.scope),
      loadPageVisits(filters, props.scope),
      loadScrollDepth(filters, props.scope).then(
        (s) => ({ ok: true as const, s }),
        (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
      ),
    ]);
    return {
      kind: "footprints-page",
      v: 1,
      app: props.appName,
      appId: props.filters.appId,
      page: props.page,
      url: props.sampleUrl,
      period: filters.timeframe === "24h" ? "Last 24 hours" : filters.timeframe === "30d" ? "Last 30 days" : "Last 7 days",
      device: filters.device === "all" ? "All devices" : filters.device.charAt(0).toUpperCase() + filters.device.slice(1),
      deviceKey: filters.device,
      pageVisits: visits,
      elements,
      scroll: scroll.ok && scroll.s.visits > 0 ? scroll.s : null,
      scrollError: scroll.ok ? null : scroll.error,
    };
  }

  async function onShow() {
    if (installed && !upToDate) {
      setStatus({ kind: "problem", message: updateMessage, payload: null });
      return;
    }
    setStatus({ kind: "working" });
    let payload: PagePayload | null = null;
    try {
      payload = await build();
      if (!installed) throw new Error("not-installed");
      await showOnPage(payload);
      setStatus({ kind: "opened" });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message =
        raw === "not-installed"
          ? "The Footprints browser extension is not installed in this browser, or it cannot reach this page."
          : raw;
      setStatus({ kind: "problem", message, payload });
    }
  }

  async function onAuto(device: "desktop" | "mobile") {
    setStatus({ kind: "auto", device, text: "Preparing the data…", pct: 1 });
    try {
      if (!installed) throw new Error("not-installed");
      if (!upToDate) throw new Error(updateMessage);
      const filters: Filters = { ...props.filters, device };
      const [payload, widths] = await Promise.all([build(filters), loadClickWidths(filters, props.scope).catch(() => [])]);
      const plan = planWidths(widths, device);
      setStatus({
        kind: "auto",
        device,
        pct: 2,
        text:
          widths.length > 0
            ? `taken at ${formatInt(plan.main)} px, the window width most visitors use${plan.others.length ? `, and measured at ${plan.others.map((w) => formatInt(w)).join(", ")} px` : ""}…`
            : "starting…",
      });
      const res = await takeAutoSnapshot({ ...payload, capture: { device, width: plan.main, widths: plan.others } }, (text, pct) => setStatus((cur) => ({ kind: "auto", device, text, pct: Math.max(pct ?? 0, cur.kind === "auto" ? cur.pct : 0) })));
      setStatus({ kind: "auto-done", device, pending: res.pending });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setStatus({
        kind: "problem",
        message: raw === "not-installed" ? "The Footprints browser extension is not installed in this browser, or it cannot reach this page." : raw,
        payload: null,
      });
    }
  }

  async function onCopy(payload: PagePayload) {
    if (await copyPayload(payload)) setStatus({ kind: "copied" });
    else setStatus({ kind: "manual", text: JSON.stringify(payload) });
  }

  const busy = status.kind === "working" || status.kind === "auto";
  const take = () => (how === "custom" ? onShow() : onAuto(how));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 12 }}>
      <div role="radiogroup" aria-label="How to take it" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {CAPTURE_OPTIONS.map((o) => {
          const on = how === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => setHow(o.value)}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: on ? 11 : 12,
                borderRadius: 9,
                border: on ? `2px solid ${c.accent}` : `1px solid ${c.line}`,
                background: on ? c.accentSoft : c.surface,
                color: c.ink,
                textAlign: "left",
                cursor: busy ? "default" : "pointer",
              }}
            >
              <span aria-hidden="true" style={{ display: "flex", color: on ? c.accent : c.muted, fontSize: 20, paddingTop: 2 }}>
                {o.icon}
              </span>
              <span>
                <span style={{ display: "block", fontWeight: 600 }}>{o.label}</span>
                <span style={{ display: "block", fontSize: 13, color: c.muted }}>{o.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="accent" color="primary" onClick={take} disabled={busy} loading={busy}>
          {how === "custom" ? "Open the page" : "Take snapshot"}
        </Button>
      </div>

      {status.kind === "auto" && (
        <div role="status" style={{ width: "100%", maxWidth: 520 }}>
          <ProgressBar value={status.pct} min={0} max={100} aria-valuetext={`${status.pct}%`}>
            <ProgressBar.Label>
              {status.device === "desktop" ? "Desktop" : "Mobile"} snapshot: {status.text}
            </ProgressBar.Label>
            <ProgressBar.Value>{status.pct}%</ProgressBar.Value>
          </ProgressBar>
        </div>
      )}
      {status.kind === "auto-done" && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: c.muted }}>
          {status.pending
            ? "The snapshot was taken and will be added the next time you open Footprints."
            : `${status.device === "desktop" ? "Desktop" : "Mobile"} snapshot saved.`}
        </p>
      )}

      {status.kind === "opened" && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: c.muted }}>
          The page opened in a new tab with the clicks drawn on it. Arrange it (cookies, menus, window size), then click “Save snapshot to Footprints” in its panel.
        </p>
      )}

      {status.kind === "problem" && (
        <div role="alert" style={{ padding: "12px 14px", borderRadius: 12, background: c.warnSoft, color: c.warnInk, fontSize: 14 }}>
          <div style={{ fontWeight: 600 }}>Could not open the page automatically</div>
          <div style={{ marginTop: 4 }}>{status.message}</div>
          {status.payload && (
            <>
              <div style={{ marginTop: 8 }}>
                You can still see it: copy the data, open{" "}
                <a href={status.payload.url} target="_blank" rel="noreferrer" style={{ color: c.warnInk, fontWeight: 600 }}>
                  the page
                </a>
                , then click the Footprints icon in the browser toolbar and choose “Show copied data on this tab”.
              </div>
              <div style={{ marginTop: 10 }}>
                <Button onClick={() => status.payload && onCopy(status.payload)}>Copy page data</Button>
              </div>
            </>
          )}
        </div>
      )}

      {status.kind === "copied" && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: c.muted }}>
          Copied. Open the page, then choose “Show copied data on this tab” in the Footprints extension.
        </p>
      )}

      {status.kind === "manual" && (
        <div style={{ width: "100%", fontSize: 14 }}>
          <label htmlFor="fp-manual" style={{ display: "block", marginBottom: 6 }}>
            Copying is blocked here. Select all the text below, copy it (Cmd/Ctrl + C), then use the extension.
          </label>
          <textarea
            id="fp-manual"
            readOnly
            value={status.text}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: "100%", height: 90, fontSize: 12, borderRadius: 8, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.ink }}
          />
        </div>
      )}
    </div>
  );
}

