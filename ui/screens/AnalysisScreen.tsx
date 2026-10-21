/**
 * Second screen: one snapshot with its numbers. Opens when a snapshot is
 * saved or picked from the list. The device is the snapshot's; the period and
 * the conversion goal can be changed. Zones and their names are saved with
 * the snapshot; the snapshot can be deleted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Dropdown, Option } from "../components/Controls";
import { PagePicker } from "../components/PagePicker";
import { MapMode, SnapshotView, ZoneCount } from "../components/SnapshotView";
import { ErrorNotice, Loading } from "../components/States";
import { runQuery, num } from "../dql/client";
import { Device, Filters, PAGE_LIMIT, PageScope, Timeframe, zoneQuery } from "../dql/queries";
import { Application, useClickPositions, useElementConversions, usePageConversion, usePageElements, usePageVisits, useScrollDepth } from "../hooks/data";
import { choiceForKey, usePageChoices } from "../hooks/pageChoices";
import { deviceName, formatWhen } from "../lib/format";
import { pageHost, pagePath } from "../lib/labels";
import type { PageGroup } from "../lib/pages";
import { deleteSnapshot, getSnapshotMeta, loadSnapshot, saveZoning, Snapshot, SnapshotMeta } from "../lib/snapshots";
import { usePersistentState } from "../lib/storage";
import { c } from "../theme";

const TIMEFRAMES: Option<Timeframe>[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const MODES: MapMode[] = ["zones", "clicks", "scroll", "table"];

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
  const [storedMode, setMode] = usePersistentState<MapMode>("fp.mapMode", "zones");
  const mode: MapMode = MODES.includes(storedMode) ? storedMode : "zones";
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
  const positions = useClickPositions(mode === "clicks" ? filters : null, scope, rk);
  const pageConv = usePageConversion(filters, scope, goal?.scope ?? null, rk);
  const elConv = useElementConversions(filters, scope, goal?.scope ?? null, rk);
  const pageVisits = visits.data ?? 0;

  // Exact visits and conversions of one zone, asked when the zone is turned on.
  const countKey = JSON.stringify([filters, scope, goal?.scope ?? null, rk]);
  const countZone = useCallback(
    async (sections: string[]): Promise<ZoneCount> => {
      if (!filters || !scope) throw new Error("No data");
      const rows = await runQuery(zoneQuery(filters, scope, goal?.scope ?? null, sections));
      return { visits: num(rows[0]?.["visits"]), converted: goal ? num(rows[0]?.["converted"]) : null };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countKey],
  );

  // Zoning: shown at once, saved a moment later (several quick changes make one save).
  const saveTimer = useRef<number | null>(null);
  const latest = useRef<{ meta: SnapshotMeta | null; snapshot: Snapshot | null }>({ meta: null, snapshot: null });
  latest.current = { meta, snapshot };
  function onZoning(zones: string[], names: Record<string, string>) {
    if (!snapshot) return;
    const next = { ...snapshot, zoning: { zones }, names };
    setSnapshot(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const { meta: m, snapshot: s } = latest.current;
      if (!m || !s) return;
      setSaving(true);
      setSaveError(null);
      try {
        const version = await saveZoning(m, s, s.zoning?.zones ?? [], s.names);
        setMeta((cur) => (cur ? { ...cur, version } : cur));
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    }, 800);
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
      </Card>

      {!scope && props.groupsReady && <ErrorNotice title="The page group of this snapshot was deleted" detail="Its pages are unknown, so there are no numbers to show." />}
      {saveError && <ErrorNotice title="Could not save your change" detail={saveError} />}
      {elements.error && <ErrorNotice title="Could not load the clicks" detail={elements.error} />}

      {scope && filters && (
        <Card label="Page map">
          {(elements.loading || visits.loading) && <Loading label="Preparing the page map…" rows={3} />}
          {elements.data && !elements.loading && !visits.loading && (
            <SnapshotView
              snapshot={snapshot}
              elements={elements.data}
              scroll={scroll.data && scroll.data.visits ? scroll.data : null}
              pageVisits={pageVisits}
              periodLabel={TIMEFRAMES.find((t) => t.value === timeframe)?.label}
              saving={saving}
              zones={snapshot.zoning?.zones ?? []}
              names={snapshot.names}
              onZoning={onZoning}
              countZone={countZone}
              countKey={countKey}
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
    </>
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
