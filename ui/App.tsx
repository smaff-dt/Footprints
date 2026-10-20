/**
 * Footprints – which parts of a page do visitors see and use?
 *
 * Pick an application and a page, filter by period and device. "Page map"
 * shows a saved snapshot of the page with its areas colored by the chosen
 * metric; "List" ranks the page's sections. "Show on the page" opens the live
 * page with the browser extension, where a snapshot can be saved.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Checkbox, Dropdown, Option, Segmented } from "./components/Controls";
import { RANK_LABELS, RankBy, rankSections, SectionDetail, SectionRanking } from "./components/SectionRanking";
import { GroupEditor, PagePicker } from "./components/PagePicker";
import { ShowOnPage } from "./components/ShowOnPage";
import { SnapshotPanel } from "./components/SnapshotPanel";
import { Empty, ErrorNotice, Loading } from "./components/States";
import { Device, Filters, GroupBy, PAGE_LIMIT, Timeframe } from "./dql/queries";
import { useApplications, usePages, usePageVisits, useScopePages, useSections } from "./hooks/data";
import { formatInt } from "./lib/format";
import { pageHost } from "./lib/labels";
import { useSnapshotInbox } from "./lib/extension";
import { choicesFor, describeRules, labelForKey, loadGroups, looseChoice, newGroupId, PageGroup, storeGroups, StoredGroups } from "./lib/pages";
import { saveSnapshot, Snapshot } from "./lib/snapshots";
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

type View = "map" | "list";

const VIEWS: Option<View>[] = [
  { value: "map", label: "Page map" },
  { value: "list", label: "List" },
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
  const [view, setView] = usePersistentState<View>("fp.view", "map");
  const [inbox, setInbox] = useState<{ tick: number; id: string | null }>({ tick: 0, id: null });
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [groups, setGroups] = useState<StoredGroups>({ groups: [], docId: null, version: null });
  const [editing, setEditing] = useState<{ group: PageGroup | null } | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Page groups are kept in a private document.
  useEffect(() => {
    loadGroups().then(setGroups, (e: unknown) => setGroupError(`Could not load your page groups: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

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

  // Pages and page groups
  const pages = usePages(filters, refreshKey);
  const choices = useMemo(() => choicesFor(pages.data ?? [], groups.groups, appId), [pages.data, groups.groups, appId]);
  // A page found by searching (or opened from a snapshot) may be outside the loaded list.
  const loose = useMemo(() => looseChoice(page), [page]);
  const choice = choices.find((ch) => ch.key === page) ?? (pages.data && pageHost(page) && pages.data.some((p) => pageHost(p.url) === pageHost(page)) ? loose : null);
  useEffect(() => {
    if (pages.data && choices.length > 0 && !choice) {
      const firstPage = choices.find((ch) => ch.kind === "page") ?? choices[0];
      setPage(firstPage.key);
    }
  }, [pages.data, choices, choice, setPage]);
  const activePage = choice ? choice.key : null;
  const scope = choice?.scope ?? null;
  // A group: its pages, most visited first (the first one is opened by "Show on the page").
  const groupPages = useScopePages(filters, choice?.kind === "group" ? scope : null, refreshKey);
  const sampleUrl = choice?.kind === "group" ? groupPages.data?.[0]?.url ?? "" : choice?.key ?? "";

  async function saveGroup(g: Omit<PageGroup, "id"> & { id?: string }) {
    setGroupSaving(true);
    setGroupError(null);
    try {
      const group: PageGroup = { ...g, id: g.id ?? newGroupId() };
      const next = g.id ? groups.groups.map((x) => (x.id === g.id ? group : x)) : [...groups.groups, group];
      setGroups(await storeGroups(groups, next));
      setPage(`group:${group.id}`);
      setEditing(null);
    } catch (e) {
      setGroupError(e instanceof Error ? e.message : String(e));
    } finally {
      setGroupSaving(false);
    }
  }

  async function deleteGroup(g: PageGroup) {
    setGroupSaving(true);
    setGroupError(null);
    try {
      setGroups(await storeGroups(groups, groups.groups.filter((x) => x.id !== g.id)));
      setEditing(null);
    } catch (e) {
      setGroupError(e instanceof Error ? e.message : String(e));
    } finally {
      setGroupSaving(false);
    }
  }

  // Snapshots arriving from the browser extension are saved as documents.
  const onSnapshot = useCallback(async (snapshot: Snapshot) => {
    const label = labelForKey(snapshot.page, groups.groups);
    const id = await saveSnapshot(snapshot, label);
    setInbox((i) => ({ tick: i.tick + 1, id }));
    setSavedNote(`Snapshot of “${label}” saved.`);
    if (snapshot.appId && snapshot.page) {
      setAppId(snapshot.appId);
      setPage(snapshot.page);
      setView("map");
    }
    return id;
  }, [setAppId, setPage, setView, groups.groups]);
  useSnapshotInbox(onSnapshot);

  // One page
  const visits = usePageVisits(filters, scope, refreshKey);
  const sections = useSections(filters, view === "list" ? scope : null, groupBy, refreshKey);

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
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>
              {choice ? choice.label : "Choose a page"}
            </h1>
            <p style={{ margin: "4px 0 0", color: c.muted }}>
              {choice
                ? choice.kind === "group" && choice.group
                  ? `Page group · ${describeRules(choice.group.rules)}${
                      groupPages.data ? ` · ${groupPages.data.length >= PAGE_LIMIT ? `${formatInt(PAGE_LIMIT)}+` : formatInt(groupPages.data.length)} page${groupPages.data.length === 1 ? "" : "s"}` : ""
                    }`
                  : `${pageHost(choice.key)} · ${choice.key}`
                : "Pick an application and one of its pages to see how visitors use it."}
            </p>
          </div>
          {filters && choice && scope && sampleUrl && (
            <ShowOnPage
              key={`${filters.appId}|${choice.key}|${filters.timeframe}|${filters.device}`}
              filters={filters}
              page={choice.key}
              scope={scope}
              sampleUrl={sampleUrl}
              appName={apps.data?.find((a) => a.id === appId)?.name ?? ""}
              periodLabel={TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? ""}
              deviceLabel={device === "all" ? "All devices" : (DEVICES.find((d) => d.value === device)?.label ?? "")}
              pageVisits={pageVisits}
            />
          )}
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
          <PagePicker
            filters={filters}
            choices={choices}
            complete={!!pages.data && pages.data.length < PAGE_LIMIT}
            value={page}
            current={choice}
            loading={pages.loading}
            onChange={(ch) => setPage(ch.key)}
            onNewGroup={() => {
              setGroupError(null);
              setEditing({ group: null });
            }}
            onEditGroup={(group) => {
              setGroupError(null);
              setEditing({ group });
            }}
          />
          <Dropdown label="Period" value={timeframe} options={TIMEFRAMES} onChange={setTimeframe} />
          <Segmented label="Device" value={device} options={DEVICES} onChange={setDevice} />
        </Card>

        {editing && filters && (
          <GroupEditor
            key={editing.group?.id ?? "new"}
            group={editing.group}
            filters={filters}
            saving={groupSaving}
            error={groupError}
            onSave={saveGroup}
            onDelete={deleteGroup}
            onCancel={() => setEditing(null)}
          />
        )}
        {!editing && groupError && <ErrorNotice title="Page groups" detail={groupError} />}
        {savedNote && (
          <div role="status" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, background: c.accentSoft, color: c.ink, fontWeight: 600 }}>
            {savedNote}
            <button type="button" onClick={() => setSavedNote(null)} aria-label="Dismiss" style={{ minHeight: 32, padding: "0 10px", borderRadius: 8, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.ink, cursor: "pointer" }}>
              OK
            </button>
          </div>
        )}
        {apps.error && <ErrorNotice title="Could not load your applications" detail={apps.error} />}
        {pages.error && (
          <ErrorNotice title="Could not load the pages" detail={pages.error} onRetry={() => setRefreshKey((k) => k + 1)} />
        )}
        {apps.data && apps.data.length === 0 && (
          <Card>
            <Empty
              title="No applications found"
              detail="No web application received clicks in the last 7 days. Ask your Dynatrace administrator to turn on user interaction capture for the applications you want to analyse."
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

        {activePage && scope && (
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
              {view === "list" && <Kpi label="Clicks on this page" value={sections.loading ? "…" : formatInt(totalClicks)} />}
              {view === "list" && <Kpi label={`Clicked ${noun}`} value={sections.loading ? "…" : formatInt(shown.length)} />}
              <div style={{ marginLeft: "auto" }}>
                <Segmented label="View" value={view} options={VIEWS} onChange={setView} />
              </div>
            </div>

            {view === "map" && filters && (
              <Card label="Page map">
                <SnapshotPanel
                  filters={filters}
                  page={activePage}
                  scope={scope!}
                  pageVisits={pageVisits}
                  refreshKey={refreshKey}
                  inboxTick={inbox.tick}
                  preferId={inbox.id}
                />
              </Card>
            )}

            {view === "list" && (
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
            )}
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
