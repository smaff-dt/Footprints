/**
 * Second screen: one snapshot with its numbers. Opens when a snapshot is
 * saved or picked from the list. The device is the snapshot's; the period and
 * the conversion goal can be changed. Areas can be renamed, the snapshot
 * deleted.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, Checkbox, Dropdown, Option, Segmented } from "../components/Controls";
import { PagePicker } from "../components/PagePicker";
import { RANK_LABELS, RankBy, rankSections, SectionDetail, SectionRanking } from "../components/SectionRanking";
import { MapMode, SnapshotView } from "../components/SnapshotView";
import { Empty, ErrorNotice, Loading } from "../components/States";
import { Device, Filters, GroupBy, PAGE_LIMIT, PageScope, Timeframe } from "../dql/queries";
import {
  Application,
  useClickPositions,
  useElementConversions,
  usePageConversion,
  usePageElements,
  usePageVisits,
  useScrollDepth,
  useSections,
} from "../hooks/data";
import { choiceForKey, usePageChoices } from "../hooks/pageChoices";
import { deviceName, formatInt, formatWhen } from "../lib/format";
import { pageHost, pagePath } from "../lib/labels";
import type { PageGroup } from "../lib/pages";
import { deleteSnapshot, getSnapshotMeta, loadSnapshot, saveNames, Snapshot, SnapshotMeta } from "../lib/snapshots";
import { usePersistentState } from "../lib/storage";
import { c } from "../theme";

const TIMEFRAMES: Option<Timeframe>[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

type View = "map" | "list";
const VIEWS: Option<View>[] = [
  { value: "map", label: "Page map" },
  { value: "list", label: "List" },
];

/** What a snapshot covers: one page, a page group, or (older snapshots) a page template with `*`. */
function scopeForKey(key: string, groups: PageGroup[]): PageScope | null {
  if (key.startsWith("group:")) {
    const g = groups.find((x) => `group:${x.id}` === key);
    return g ? { kind: "group", rules: g.rules } : null;
  }
  if (key.includes("*")) {
    const path = pagePath(key);
    return {
      kind: "group",
      rules: [
        { part: "host", op: "is", value: pageHost(key) },
        { part: "path", op: "starts", value: path.slice(0, path.indexOf("*")) || "/" },
      ],
    };
  }
  return { kind: "page", url: key };
}

export function AnalysisScreen(props: {
  id: string;
  apps: Application[];
  groups: PageGroup[];
  groupsReady: boolean;
  refreshKey: number;
  onBack: (changed: boolean) => void;
  onEditGroup: (group: PageGroup | null, appId: string, then: (key: string) => void) => void;
}) {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [timeframe, setTimeframe] = usePersistentState<Timeframe>("fp.timeframe", "7d");
  const [view, setView] = usePersistentState<View>("fp.view", "map");
  const [mode, setMode] = usePersistentState<MapMode>("fp.mapMode", "areas");
  const [goalKey, setGoalKey] = usePersistentState("fp.goal", "");
  const [goalPagesWanted, setGoalPagesWanted] = useState(false);

  useEffect(() => {
    let alive = true;
    setMeta(null);
    setSnapshot(null);
    setLoadError(null);
    Promise.all([getSnapshotMeta(props.id), loadSnapshot(props.id)]).then(
      ([m, s]) => {
        if (!alive) return;
        setMeta(m);
        setSnapshot(s);
      },
      (e: unknown) => alive && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [props.id]);

  const scope = useMemo(() => (snapshot && props.groupsReady ? scopeForKey(snapshot.page, props.groups) : null), [snapshot, props.groups, props.groupsReady]);
  const device: Device = snapshot && ["desktop", "tablet", "mobile"].includes(snapshot.device) ? (snapshot.device as Device) : "all";
  const filters = useMemo<Filters | null>(() => (snapshot ? { appId: snapshot.appId, timeframe, device } : null), [snapshot, timeframe, device]);
  const rk = props.refreshKey;

  // Conversion goal: a page or page group of the same application.
  const { choices, pages } = usePageChoices(snapshot?.appId ?? null, props.groups, goalPagesWanted, rk);
  const goalChoice = snapshot ? choiceForKey(goalKey, choices, pageHost(snapshot.url)) : null;
  const goal = useMemo(() => (goalChoice ? { scope: goalChoice.scope, label: goalChoice.label } : null), [goalChoice]);

  const visits = usePageVisits(filters, scope, rk);
  const elements = usePageElements(filters, scope, rk);
  const scroll = useScrollDepth(filters, scope, rk);
  const positions = useClickPositions(view === "map" && mode === "clicks" ? filters : null, scope, rk);
  const pageConv = usePageConversion(filters, scope, goal?.scope ?? null, rk);
  const elConv = useElementConversions(view === "map" ? filters : null, scope, goal?.scope ?? null, rk);
  const pageVisits = visits.data ?? 0;

  async function rename(areaKey: string, name: string) {
    if (!snapshot || !meta) return;
    const names = { ...snapshot.names, [areaKey]: name };
    const before = snapshot;
    setSnapshot({ ...snapshot, names });
    setSaving(true);
    setSaveError(null);
    try {
      const version = await saveNames(meta, snapshot, names);
      setMeta({ ...meta, version });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSnapshot(before);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!meta) return;
    try {
      await deleteSnapshot(meta);
      props.onBack(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  const appName = snapshot ? props.apps.find((a) => a.id === snapshot.appId)?.name ?? snapshot.appId : "";
  const back = (
    <button
      type="button"
      onClick={() => props.onBack(false)}
      style={{ alignSelf: "flex-start", minHeight: 36, padding: "0 12px", borderRadius: 10, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.ink, fontWeight: 600, cursor: "pointer" }}
    >
      ‹ All snapshots
    </button>
  );

  if (loadError) {
    return (
      <>
        {back}
        <ErrorNotice title="Could not open this snapshot" detail={loadError} />
      </>
    );
  }
  if (!snapshot || !meta) {
    return (
      <>
        {back}
        <Loading label="Opening the snapshot…" rows={3} />
      </>
    );
  }

  return (
    <>
      {back}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>{meta.label}</h1>
          <p style={{ margin: "4px 0 0", color: c.muted }}>
            {appName} · {deviceName(snapshot.device)} snapshot · taken {formatWhen(snapshot.capturedAt)} {snapshot.capture === "auto" ? "automatically" : "by hand"}
          </p>
        </div>
        {confirmDelete ? (
          <span style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
            <span style={{ fontSize: 14 }}>Delete this snapshot?</span>
            <button type="button" onClick={remove} style={{ ...plainButton, border: "1px solid #9A3412", color: "#9A3412" }}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} style={plainButton}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} style={plainButton}>
            Delete snapshot
          </button>
        )}
      </div>

      <Card label="Filters" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 20 }}>
        <Dropdown label="Period" value={timeframe} options={TIMEFRAMES} onChange={setTimeframe} />
        <PagePicker
          label="Conversion goal"
          placeholder="No goal"
          noneLabel="No goal"
          onClear={() => setGoalKey("")}
          filters={filters ? { ...filters, timeframe: "7d", device: "all" } : null}
          choices={choices}
          complete={!!pages.data && pages.data.length < PAGE_LIMIT}
          value={goalKey}
          current={goalChoice}
          loading={pages.loading}
          onOpen={() => setGoalPagesWanted(true)}
          onChange={(ch) => setGoalKey(ch.key)}
          onNewGroup={() => props.onEditGroup(null, snapshot.appId, setGoalKey)}
          onEditGroup={(g) => props.onEditGroup(g, snapshot.appId, setGoalKey)}
        />
        <div style={{ fontSize: 13, color: c.muted, maxWidth: 320 }}>
          Numbers come from {deviceName(snapshot.device).toLowerCase()} visits, like the snapshot.
        </div>
      </Card>

      {!scope && props.groupsReady && <ErrorNotice title="The page group of this snapshot was deleted" detail="Its pages are unknown, so there are no numbers to show." />}
      {saveError && <ErrorNotice title="Could not save your change" detail={saveError} />}

      {scope && filters && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 32px", padding: "14px 18px", borderRadius: 14, background: c.surface, border: `1px solid ${c.line}`, alignItems: "center" }}>
            <Kpi label="Visits to this page" value={visits.loading ? "…" : formatInt(pageVisits)} />
            {goal && pageConv.data && <Kpi label={`Reach “${goal.label}”`} value={pageConv.data.visits ? `${((100 * pageConv.data.converted) / pageConv.data.visits).toFixed(1)}%` : "–"} />}
            <div style={{ marginLeft: "auto" }}>
              <Segmented label="View" value={view} options={VIEWS} onChange={setView} />
            </div>
          </div>

          {view === "map" && (
            <Card label="Page map">
              {elements.error && <ErrorNotice title="Could not load the clicks" detail={elements.error} />}
              {(elements.loading || visits.loading) && <Loading label="Preparing the page map…" rows={3} />}
              {elements.data && !elements.loading && !visits.loading && (
                <SnapshotView
                  snapshot={snapshot}
                  elements={elements.data}
                  scroll={scroll.data && scroll.data.visits ? scroll.data : null}
                  pageVisits={pageVisits}
                  deviceKey={device}
                  saving={saving}
                  onRename={rename}
                  mode={mode}
                  onMode={setMode}
                  heat={mode === "clicks" ? { rows: positions.data, loading: positions.loading, error: positions.error } : null}
                  goal={
                    goal
                      ? { label: goal.label, page: pageConv.data, elements: elConv.data, loading: pageConv.loading || elConv.loading, error: pageConv.error ?? elConv.error }
                      : null
                  }
                />
              )}
            </Card>
          )}
          {view === "list" && <SectionListView filters={filters} scope={scope} pageVisits={pageVisits} visitsLoading={visits.loading} refreshKey={rk} />}
        </>
      )}
    </>
  );
}

const MIN_VISITS = 20;
const GROUPINGS: Option<GroupBy>[] = [
  { value: "sections", label: "Page sections" },
  { value: "elements", label: "Individual elements" },
];
const RANKINGS: Option<RankBy>[] = (Object.keys(RANK_LABELS) as RankBy[]).map((k) => ({ value: k, label: RANK_LABELS[k] }));

/** The ranking of the page's sections or elements, without a picture. */
function SectionListView(props: { filters: Filters; scope: PageScope; pageVisits: number; visitsLoading: boolean; refreshKey: number }) {
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>("fp.groupBy", "sections");
  const [rankBy, setRankBy] = usePersistentState<RankBy>("fp.rankBy", "rate");
  const [hideSmall, setHideSmall] = usePersistentState("fp.hideSmall", true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const sections = useSections(props.filters, props.scope, groupBy, props.refreshKey);
  useEffect(() => setSelectedKey(null), [groupBy]);
  const ranked = useMemo(() => (sections.data ? rankSections(sections.data, props.pageVisits, rankBy) : []), [sections.data, props.pageVisits, rankBy]);
  const shown = hideSmall ? ranked.filter((s) => s.visits >= MIN_VISITS) : ranked;
  const hiddenCount = ranked.length - shown.length;
  const selected = shown.find((s) => s.key === selectedKey) ?? shown[0] ?? null;
  const noun = groupBy === "sections" ? "sections" : "elements";
  const loading = sections.loading || props.visitsLoading;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
      <Card label="Ranking" style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <Segmented label="Show" value={groupBy} options={GROUPINGS} onChange={setGroupBy} />
          <Dropdown label="Rank by" value={rankBy} options={RANKINGS} onChange={setRankBy} />
        </div>
        <Checkbox label={`Hide ${noun} with fewer than ${MIN_VISITS} visits`} checked={hideSmall} onChange={setHideSmall} />
        {sections.error && <ErrorNotice title={`Could not load the page ${noun}`} detail={sections.error} />}
        {loading && <Loading label={`Counting clicks per ${noun.slice(0, -1)}…`} />}
        {!loading && sections.data && shown.length === 0 && (
          <Empty
            title={`No ${noun} to show`}
            detail={hiddenCount > 0 ? `All ${noun} on this page have fewer than ${MIN_VISITS} visits. Untick the box above to see them anyway.` : "Nobody clicked on this page in the selected period."}
          />
        )}
        {!loading && shown.length > 0 && (
          <>
            <SectionRanking sections={shown} rankBy={rankBy} selectedKey={selected?.key ?? null} onSelect={setSelectedKey} />
            {hiddenCount > 0 && (
              <p style={{ margin: 0, fontSize: 13, color: c.muted }}>
                {hiddenCount} {hiddenCount === 1 ? noun.slice(0, -1) : noun} with too little data hidden.
              </p>
            )}
          </>
        )}
      </Card>
      <Card label="Details" style={{ flex: "1 1 340px", minWidth: 0 }}>
        {selected && !loading ? (
          <SectionDetail section={selected} pageVisits={props.pageVisits} isElement={groupBy === "elements"} />
        ) : (
          <Empty title="Nothing selected" detail={`Pick one of the ${noun} on the left to see its details.`} />
        )}
      </Card>
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

const plainButton = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 10,
  border: `1px solid ${c.lineStrong}`,
  background: c.surface,
  color: c.ink,
  fontWeight: 600,
  cursor: "pointer",
} as const;
