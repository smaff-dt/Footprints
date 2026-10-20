/**
 * "Show on the page": opens the live page with the clicks drawn on it,
 * through the Footprints browser extension.
 */
import { CSSProperties, useState } from "react";
import { Filters } from "../dql/queries";
import { loadPageElements, loadScrollDepth } from "../hooks/data";
import { copyPayload, PagePayload, showOnPage, useExtensionInstalled } from "../lib/extension";
import { c } from "../theme";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "opened" }
  | { kind: "problem"; message: string; payload: PagePayload | null }
  | { kind: "copied" }
  | { kind: "manual"; text: string };

export function ShowOnPage(props: {
  filters: Filters;
  page: string;
  sampleUrl: string;
  appName: string;
  periodLabel: string;
  deviceLabel: string;
  pageVisits: number;
}) {
  const installed = useExtensionInstalled();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function build(): Promise<PagePayload> {
    // Scroll depth is a plus: if it fails, the page still shows the clicks.
    const [elements, scroll] = await Promise.all([
      loadPageElements(props.filters, props.page),
      loadScrollDepth(props.filters, props.page).then(
        (s) => ({ ok: true as const, s }),
        (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
      ),
    ]);
    return {
      kind: "footprints-page",
      v: 1,
      app: props.appName,
      page: props.page,
      url: props.sampleUrl || props.page.replace(/\*/g, ""),
      period: props.periodLabel,
      device: props.deviceLabel,
      deviceKey: props.filters.device,
      pageVisits: props.pageVisits,
      elements,
      scroll: scroll.ok && scroll.s.visits > 0 ? scroll.s : null,
      scrollError: scroll.ok ? null : scroll.error,
    };
  }

  async function onShow() {
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

  async function onCopy(payload: PagePayload) {
    if (await copyPayload(payload)) setStatus({ kind: "copied" });
    else setStatus({ kind: "manual", text: JSON.stringify(payload) });
  }

  const primary: CSSProperties = {
    minHeight: 44,
    padding: "0 18px",
    borderRadius: 10,
    border: `1px solid ${c.ink}`,
    background: c.ink,
    color: c.surface,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };
  const secondary: CSSProperties = {
    ...primary,
    background: c.surface,
    color: c.ink,
    border: `1px solid ${c.lineStrong}`,
    fontWeight: 600,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, maxWidth: 520 }}>
      <button type="button" onClick={onShow} disabled={status.kind === "working"} style={primary}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 4h6v6" />
          <path d="M20 4 11 13" />
          <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
        </svg>
        {status.kind === "working" ? "Preparing the page…" : "Show on the page"}
      </button>

      {status.kind === "opened" && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: c.muted }}>
          The page opened in a new tab with the clicks drawn on it.
        </p>
      )}

      {status.kind === "problem" && (
        <div role="alert" style={{ padding: "12px 14px", borderRadius: 12, background: c.warnSoft, color: c.warnInk, fontSize: 14 }}>
          <div style={{ fontWeight: 700 }}>Could not open the page automatically</div>
          <div style={{ marginTop: 4 }}>{status.message}</div>
          {status.payload && (
            <>
              <div style={{ marginTop: 8 }}>
                You can still see it: copy the data, open{" "}
                <a href={status.payload.url} target="_blank" rel="noreferrer" style={{ color: c.warnInk, fontWeight: 700 }}>
                  the page
                </a>
                , then click the Footprints icon in the browser toolbar and choose “Show copied data on this tab”.
              </div>
              <button type="button" onClick={() => status.payload && onCopy(status.payload)} style={{ ...secondary, marginTop: 10 }}>
                Copy page data
              </button>
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
