/**
 * Footprints – which parts of a page do visitors use?
 *
 * Phase 1: pick an application and a page, filter by period and device,
 * and see the page's sections ranked by how many visits click them.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, Checkbox, Dropdown, Option, Segmented } from "./components/Controls";
import { RANK_LABELS, RankBy, rankSections, SectionDetail, SectionRanking } from "./components/SectionRanking";
import { Empty, ErrorNotice, Loading } from "./components/States";
import { Device, Filters, GroupBy, Timeframe } from "./dql/queries";
import { useApplications, usePages, usePageVisits, useSections } from "./hooks/data";
import { formatInt } from "./lib/format";
import { pageHost, pageLabel } from "./lib/labels";
import { usePersistentState } from "./lib/storage";
import { c, GLOBAL_CSS } from "./theme";

const MIN_VISITS = 20;

const TIMEFRAMES: Option<Timeframe>[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const DEVICES: Option<Device>[] = [
  { value: "all", label: "All" },
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "mobile", label: "Mobile" },
];

const GROUPINGS: Option<GroupBy>[] = [
  { value: "sections", label: "Page sections" },
  { value: "elements", label: "Individual elements" },
];

const RANKINGS: Option<RankBy>[] = (Object.keys(RANK_LABELS) as RankBy[]).map((k) => ({ value: k, label: RANK_LABELS[k] }));

export function App() {
  const [appId, setAppId] = usePersistentState("fp.appId", "");
  const [timeframe, setTimeframe] = usePersistentState<Timeframe>("fp.timeframe", "7d");
  const [device, setDevice] = usePersistentState<Device>("fp.device", "all");
  const [page, setPage] = usePersistentState("fp.page", "");
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>("fp.groupBy", "sections");
  const [rankBy, setRankBy] = usePersistentState<RankBy>("fp.rankBy", "rate");
  const [hideSmall, setHideSmall] = usePersistentState("fp.hideSmall", true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Applications
  const apps = useApplications();
  useEffect(() => {
    if (apps.data && apps.data.length > 0 && !apps.data.some((a) => a.id === appId)) {
      setAppId(apps.data[0].id);
    }
  }, [apps.data, appId, setAppId]);

  const filters: Filters | null = useMemo(
    () => (appId && apps.data?.some((a) => a.id === appId) ? { appId, timeframe, device } : null),
    [appId, timeframe, device, apps.data],
  );

  // Pages
  const pages = usePages(filters, refreshKey);
  useEffect(() => {
    if (pages.data && pages.data.length > 0 && !pages.data.some((p) => p.url === page)) {
      setPage(pages.data[0].url);
    }
  }, [pages.data, page, setPage]);
  const pageReady = !!pages.data?.some((p) => p.url === page);
  const activePage = pageReady ? page : null;

  // One page
  const visits = usePageVisits(filters, activePage, refreshKey);
  const sections = useSections(filters, activePage, groupBy, refreshKey);

  useEffect(() => setSelectedKey(null), [appId, page, groupBy]);

  const pageVisits = visits.data ?? 0;
  const ranked = useMemo(
    () => (sections.data ? rankSections(sections.data, pageVisits, rankBy) : []),
    [sections.data, pageVisits, rankBy],
  );
  const shown = hideSmall ? ranked.filter((s) => s.visits >= MIN_VISITS) : ranked;
  const hiddenCount = ranked.length - shown.length;
  const selected = shown.find((s) => s.key === selectedKey) ?? shown[0] ?? null;
  const totalClicks = ranked.reduce((sum, s) => sum + s.clicks, 0);

  const multiHost = new Set((pages.data ?? []).map((p) => pageHost(p.url))).size > 1;
  const pageOptions: Option<string>[] = (pages.data ?? []).map((p) => ({
    value: p.url,
    label: `${pageLabel(p.url)}${multiHost ? ` (${pageHost(p.url)})` : ""} — ${formatInt(p.visits)} visits`,
  }));

  const noun = groupBy === "sections" ? "sections" : "elements";

  return (
    <div style={{ minHeight: "100vh", background: c.ground, color: c.ink }}>
      <style>{GLOBAL_CSS}</style>

      <header style={{ background: c.surface, borderBottom: `1px solid ${c.line}` }}>
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "12px 24px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Logo />
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.01em" }}>Footprints</div>
              <div style={{ fontSize: 13, color: c.muted }}>Which parts of your pages do visitors use?</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            style={{
              minHeight: 44,
              padding: "0 16px",
              borderRadius: 10,
              border: `1px solid ${c.lineStrong}`,
              background: c.surface,
              color: c.ink,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Refresh data
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>
            {activePage ? pageLabel(activePage) : "Choose a page"}
          </h1>
          <p style={{ margin: "4px 0 0", color: c.muted }}>
            {activePage ? pageHost(activePage) : "Pick an application and one of its pages to see how visitors use it."}
          </p>
        </div>

        <Card label="Filters" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 20 }}>
          <Dropdown
            label="Application"
            value={apps.data?.some((a) => a.id === appId) ? appId : ""}
            placeholder={apps.loading ? "Loading applications…" : "Choose an application"}
            options={(apps.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={setAppId}
            disabled={!apps.data || apps.data.length === 0}
          />
          <Dropdown
            label="Page"
            wide
            value={pageReady ? page : ""}
            placeholder={pages.loading ? "Loading pages…" : "Choose a page"}
            options={pageOptions}
            onChange={setPage}
            disabled={pageOptions.length === 0}
          />
          <Dropdown label="Period" value={timeframe} options={TIMEFRAMES} onChange={setTimeframe} />
          <Segmented label="Device" value={device} options={DEVICES} onChange={setDevice} />
        </Card>

        {apps.error && <ErrorNotice title="Could not load your applications" detail={apps.error} />}
        {pages.error && (
          <ErrorNotice title="Could not load the pages" detail={pages.error} onRetry={() => setRefreshKey((k) => k + 1)} />
        )}
        {apps.data && apps.data.length === 0 && (
          <Card>
            <Empty
              title="No applications found"
              detail="Footprints did not find any monitored web application on this environment."
            />
          </Card>
        )}
        {filters && pages.data && pages.data.length === 0 && (
          <Card>
            <Empty
              title="No clicks recorded in this period"
              detail="Try a longer period or another device. If this application never shows clicks, ask your Dynatrace administrator to turn on user interaction capture for it."
            />
          </Card>
        )}

        {activePage && (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "12px 32px",
                padding: "14px 18px",
                borderRadius: 14,
                background: c.surface,
                border: `1px solid ${c.line}`,
              }}
            >
              <Kpi label="Visits to this page" value={visits.loading ? "…" : formatInt(pageVisits)} />
              <Kpi label="Clicks on this page" value={sections.loading ? "…" : formatInt(totalClicks)} />
              <Kpi label={`Clicked ${noun}`} value={sections.loading ? "…" : formatInt(shown.length)} />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
              <Card
                label="Ranking"
                style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
                  <Segmented label="Show" value={groupBy} options={GROUPINGS} onChange={setGroupBy} />
                  <Dropdown label="Rank by" value={rankBy} options={RANKINGS} onChange={setRankBy} />
                </div>
                <Checkbox
                  label={`Hide ${noun} with fewer than ${MIN_VISITS} visits`}
                  checked={hideSmall}
                  onChange={setHideSmall}
                />

                {sections.error && (
                  <ErrorNotice
                    title={`Could not load the page ${noun}`}
                    detail={sections.error}
                    onRetry={() => setRefreshKey((k) => k + 1)}
                  />
                )}
                {(sections.loading || visits.loading) && <Loading label={`Counting clicks per ${noun.slice(0, -1)}…`} />}
                {!sections.loading && !visits.loading && sections.data && shown.length === 0 && (
                  <Empty
                    title={`No ${noun} to show`}
                    detail={
                      hiddenCount > 0
                        ? `All ${noun} on this page have fewer than ${MIN_VISITS} visits. Untick the box above to see them anyway.`
                        : "Nobody clicked on this page in the selected period."
                    }
                  />
                )}
                {!sections.loading && !visits.loading && shown.length > 0 && (
                  <>
                    <SectionRanking
                      sections={shown}
                      rankBy={rankBy}
                      selectedKey={selected?.key ?? null}
                      onSelect={setSelectedKey}
                    />
                    {hiddenCount > 0 && (
                      <p style={{ margin: 0, fontSize: 13, color: c.muted }}>
                        {hiddenCount} {hiddenCount === 1 ? noun.slice(0, -1) : noun} with too little data hidden.
                      </p>
                    )}
                  </>
                )}
              </Card>

              <Card label="Details" style={{ flex: "1 1 340px", minWidth: 0 }}>
                {selected && !sections.loading && !visits.loading ? (
                  <SectionDetail section={selected} pageVisits={pageVisits} isElement={groupBy === "elements"} />
                ) : (
                  <Empty title="Nothing selected" detail={`Pick one of the ${noun} on the left to see its details.`} />
                )}
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Kpi(props: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: c.muted }}>{props.label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="36" height="36" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#16191F" />
      <g fill="#EE9B4D">
        <ellipse cx="23" cy="38" rx="7" ry="10" />
        <circle cx="16" cy="24" r="2.6" />
        <circle cx="21" cy="21" r="2.8" />
        <circle cx="27" cy="21.5" r="2.6" />
        <circle cx="31.5" cy="25" r="2.3" />
      </g>
      <g fill="#F6D9A8">
        <ellipse cx="41" cy="30" rx="6" ry="8.5" />
        <circle cx="35.5" cy="18.5" r="2.2" />
        <circle cx="39.5" cy="16" r="2.4" />
        <circle cx="44.5" cy="16.5" r="2.2" />
        <circle cx="48.3" cy="19.5" r="2" />
      </g>
    </svg>
  );
}
