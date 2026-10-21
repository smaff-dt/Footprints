/**
 * Taking a snapshot of the page, through the Footprints browser extension:
 * - Desktop / Mobile: automatic, in a background tab, at the window width
 *   visitors use most, measured at the other common widths too;
 * - Open the page: the live page opens with the clicks drawn on it, to
 *   arrange it by hand (cookies, menus, window size) and save a snapshot.
 */
import { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { DesktopIcon, ExternalLinkIcon, MobileIcon } from "@dynatrace/strato-icons";
import { Filters, PageScope } from "../dql/queries";
import { loadClickWidths, loadPageElements, loadPageVisits, loadScrollDepth } from "../hooks/data";
import { formatInt } from "../lib/format";
import { copyPayload, PagePayload, planWidths, showOnPage, takeAutoSnapshot, useExtensionVersion, versionAtLeast } from "../lib/extension";
import { c } from "../theme";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "auto"; device: "desktop" | "mobile"; text: string }
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
  const NEEDED = "0.5.1";
  const upToDate = versionAtLeast(version, NEEDED);
  const updateMessage = `The Footprints extension needs an update (version ${NEEDED} or later; this browser has ${version}): open chrome://extensions, click ↻ on Footprints, then reload this page.`;
  const [status, setStatus] = useState<Status>({ kind: "idle" });

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
    setStatus({ kind: "auto", device, text: "Preparing the data…" });
    try {
      if (!installed) throw new Error("not-installed");
      if (!upToDate) throw new Error(updateMessage);
      const filters: Filters = { ...props.filters, device };
      const [payload, widths] = await Promise.all([build(filters), loadClickWidths(filters, props.scope).catch(() => [])]);
      const plan = planWidths(widths, device);
      setStatus({
        kind: "auto",
        device,
        text:
          widths.length > 0
            ? `taken at ${formatInt(plan.main)} px, the window width most visitors use${plan.others.length ? `, and measured at ${plan.others.map((w) => formatInt(w)).join(", ")} px` : ""}…`
            : "starting…",
      });
      const res = await takeAutoSnapshot({ ...payload, capture: { device, width: plan.main, widths: plan.others } }, (text) => setStatus({ kind: "auto", device, text }));
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
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-start" }}>
        <Button variant="accent" color="primary" onClick={() => onAuto("desktop")} disabled={busy} loading={status.kind === "auto" && status.device === "desktop"}>
          <Button.Prefix>
            <DesktopIcon />
          </Button.Prefix>
          Desktop snapshot
        </Button>
        <Button variant="emphasized" onClick={() => onAuto("mobile")} disabled={busy} loading={status.kind === "auto" && status.device === "mobile"}>
          <Button.Prefix>
            <MobileIcon />
          </Button.Prefix>
          Mobile snapshot
        </Button>
        <Button variant="emphasized" onClick={onShow} disabled={busy} loading={status.kind === "working"}>
          <Button.Prefix>
            <ExternalLinkIcon />
          </Button.Prefix>
          Open the page
        </Button>
      </div>

      {status.kind === "auto" && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: c.muted }}>
          {status.device === "desktop" ? "Desktop" : "Mobile"} snapshot: {status.text}
        </p>
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

