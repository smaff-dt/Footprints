/**
 * Second screen: one snapshot with its numbers. Opens when a snapshot is
 * saved or picked from the list. The device is the snapshot's; the period and
 * the conversion goal can be changed. Zones and their names are saved with
 * the snapshot; the snapshot can be deleted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Heading } from "@dynatrace/strato-components/typography";
import { Menu } from "@dynatrace/strato-components/navigation";
import { ChevronLeftIcon, DeleteIcon, DotMenuIcon } from "@dynatrace/strato-icons";
import { Dropdown, Option } from "../components/Controls";
import { PagePicker } from "../components/PagePicker";
import { MapMode, SnapshotView, ZoneCount } from "../components/SnapshotView";
import { ErrorNotice, Loading } from "../components/States";
import { runQuery, num } from "../dql/client";
import { Device, Filters, PAGE_LIMIT, PageScope, Timeframe, zoneQuery } from "../dql/queries";
import { Application, useClickPositions, useElementConversions, usePageConversion, usePageElements, usePageVisits, useScrollDepth } from "../hooks/data";
import { choiceForKey, usePageChoices } from "../hooks/pageChoices";
import { deviceName, formatInt, formatRelative, formatWhen } from "../lib/format";
import { pageHost, pagePath } from "../lib/labels";
import type { PageGroup } from "../lib/pages";
import { formatShare, matchClicks } from "../lib/snapshotMath";
import { deleteSnapshot, getSnapshotMeta, loadSnapshot, saveZoning, Snapshot, SnapshotMeta } from "../lib/snapshots";
import { deleteThumbnail, syncThumbnail } from "../lib/thumbnails";
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
        latest.current = { meta: m, snapshot: s };
        // Older snapshots get their thumbnail now that the picture is here.
        void syncThumbnail(m.id, s, s.zoning?.zones.length ?? 0);
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

  // Zoning: shown at once, saved a moment later. Saves go one at a time,
  // each from the document's latest version; if Dynatrace reports a newer
  // version (a conflict), it is read again and the save retried once.
  const saveTimer = useRef<number | null>(null);
  const latest = useRef<{ meta: SnapshotMeta | null; snapshot: Snapshot | null }>({ meta: null, snapshot: null });
  const inFlight = useRef(false);
  /** The list of snapshots shows zone counts: it reloads when they changed. */
  const zoningChanged = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    latest.current.meta = meta;
  }, [meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      do {
        dirty.current = false;
        const { meta: m, snapshot: s } = latest.current;
        if (!m || !s) break;
        let version: string;
        try {
          version = await saveZoning(m, s, s.zoning?.zones ?? [], s.names);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!/409|version/i.test(message)) throw e;
          const fresh = await getSnapshotMeta(m.id);
          version = await saveZoning(fresh, s, s.zoning?.zones ?? [], s.names);
        }
        latest.current.meta = { ...m, version };
        setMeta(latest.current.meta);
        zoningChanged.current = true;
        void syncThumbnail(m.id, s, s.zoning?.zones.length ?? 0);
      } while (dirty.current);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function onZoning(zones: string[], names: Record<string, string>) {
    if (!snapshot) return;
    const next = { ...snapshot, zoning: { zones }, names };
    setSnapshot(next);
    latest.current.snapshot = next;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 600);
  }

  async function remove() {
    if (!meta) return;
    try {
      await deleteSnapshot(meta);
      void deleteThumbnail(meta.id);
      props.onBack(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  const appName = snapshot ? props.apps.find((a) => a.id === snapshot.appId)?.name ?? snapshot.appId : "";
  const coverage = useMemo(() => {
    if (!snapshot || !elements.data) return null;
    const m = matchClicks(snapshot.map, elements.data);
    return m.totalClicks ? m.matchedClicks / m.totalClicks : 1;
  }, [snapshot, elements.data]);

  const back = (
    <Button aria-label="All snapshots" title="All snapshots" onClick={() => props.onBack(zoningChanged.current)}>
      <Button.Prefix>
        <ChevronLeftIcon />
      </Button.Prefix>
    </Button>
  );

  if (loadError) {
    return (
      <>
        <div>{back}</div>
        <ErrorNotice title="Could not open this snapshot" detail={loadError} />
      </>
    );
  }
  if (!snapshot || !meta) {
    return (
      <>
        <div>{back}</div>
        <Loading label="Opening the snapshot…" rows={3} />
      </>
    );
  }

  // One line of context under the title.
  const facts = [
    appName,
    `${deviceName(snapshot.device)} snapshot`,
    formatRelative(snapshot.capturedAt),
    visits.data !== null && visits.data !== undefined ? `${formatInt(pageVisits)} visits` : null,
    coverage !== null ? `${formatShare(coverage)} of clicks found` : null,
    goal && pageConv.data && pageConv.data.visits ? `${formatShare(pageConv.data.converted / pageConv.data.visits)} reach “${goal.label}”` : null,
    saving ? "Saving…" : null,
  ].filter(Boolean);

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ paddingTop: 2 }}>{back}</div>
          <div style={{ minWidth: 0 }}>
            <Heading level={2} style={{ overflowWrap: "anywhere" }}>
              {meta.label}
            </Heading>
            <div data-facts style={{ color: c.muted, fontSize: 13, marginTop: 2 }} title={`Taken ${formatWhen(snapshot.capturedAt)} ${snapshot.capture === "auto" ? "automatically" : "by hand"}`}>
              {facts.join(" · ")}
            </div>
          </div>
        </div>
        <div role="group" aria-label="Filters" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
          <Dropdown label="Period" value={timeframe} options={TIMEFRAMES} onChange={setTimeframe} />
          <div style={{ display: "flex", width: 300, maxWidth: "100%" }}>
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
          </div>
          {confirmDelete ? (
            <span role="alert" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span>Delete this snapshot?</span>
              <Button variant="accent" color="critical" onClick={remove}>
                Delete
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          ) : (
            <Menu>
              <Menu.Trigger>
                <Button aria-label="More actions">
                  <Button.Prefix>
                    <DotMenuIcon />
                  </Button.Prefix>
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item onSelect={() => setConfirmDelete(true)}>
                  <Menu.Prefix>
                    <DeleteIcon />
                  </Menu.Prefix>
                  Delete snapshot
                </Menu.Item>
              </Menu.Content>
            </Menu>
          )}
        </div>
      </div>

      {!scope && props.groupsReady && <ErrorNotice title="The page group of this snapshot was deleted" detail="Its pages are unknown, so there are no numbers to show." />}
      {saveError && <ErrorNotice title="Could not save your change" detail={saveError} />}
      {elements.error && <ErrorNotice title="Could not load the clicks" detail={elements.error} />}

      {scope && filters && (
        <>
          {(elements.loading || visits.loading) && <Loading label="Preparing the page map…" rows={3} />}
          {elements.data && !elements.loading && !visits.loading && (
            <SnapshotView
              snapshot={snapshot}
              elements={elements.data}
              scroll={scroll.data && scroll.data.visits ? scroll.data : null}
              pageVisits={pageVisits}
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
        </>
      )}
    </>
  );
}
