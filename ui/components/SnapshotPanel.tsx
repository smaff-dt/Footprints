/**
 * The "Page map" view: the snapshots saved for the chosen page, the selected
 * one with its numbers for the current filters, renaming and deleting.
 */
import { useEffect, useMemo, useState } from "react";
import type { Filters } from "../dql/queries";
import { usePageElements, useScrollDepth } from "../hooks/data";
import { deleteSnapshot, listSnapshots, loadSnapshot, saveNames, Snapshot, SnapshotMeta } from "../lib/snapshots";
import { c } from "../theme";
import { Dropdown } from "./Controls";
import { SnapshotView } from "./SnapshotView";
import { Empty, ErrorNotice, Loading } from "./States";

export function SnapshotPanel(props: {
  filters: Filters;
  page: string;
  pageVisits: number;
  refreshKey: number;
  /** Changes when a new snapshot has been saved; `preferId` is then selected. */
  inboxTick: number;
  preferId: string | null;
}) {
  const { filters, page } = props;
  const [list, setList] = useState<SnapshotMeta[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [listTick, setListTick] = useState(0);

  // Snapshots of this page
  useEffect(() => {
    let alive = true;
    setList(null);
    setListError(null);
    listSnapshots(filters.appId, page)
      .then((l) => {
        if (!alive) return;
        setList(l);
        setSelectedId((cur) =>
          props.preferId && l.some((s) => s.id === props.preferId) ? props.preferId : cur && l.some((s) => s.id === cur) ? cur : l[0]?.id ?? null,
        );
      })
      .catch((e: unknown) => alive && setListError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.appId, page, props.inboxTick, listTick]);

  // The selected snapshot
  useEffect(() => {
    let alive = true;
    setSnapshot(null);
    setLoadError(null);
    setConfirmDelete(false);
    if (!selectedId) return;
    loadSnapshot(selectedId)
      .then((s) => alive && setSnapshot(s))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const elements = usePageElements(filters, snapshot ? page : null, props.refreshKey);
  const scroll = useScrollDepth(filters, snapshot ? page : null, props.refreshKey);
  const meta = useMemo(() => list?.find((s) => s.id === selectedId) ?? null, [list, selectedId]);

  async function rename(areaKey: string, name: string) {
    if (!snapshot || !meta) return;
    const names = { ...snapshot.names, [areaKey]: name };
    setSnapshot({ ...snapshot, names });
    setSaving(true);
    setSaveError(null);
    try {
      const version = await saveNames(meta, snapshot, names);
      setList((l) => l?.map((s) => (s.id === meta.id ? { ...s, version } : s)) ?? l);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSnapshot(snapshot); // undo
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!meta) return;
    try {
      await deleteSnapshot(meta);
      setSelectedId(null);
      setListTick((t) => t + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  if (listError) return <ErrorNotice title="Could not load the snapshots of this page" detail={listError} onRetry={() => setListTick((t) => t + 1)} />;
  if (!list) return <Loading label="Looking for snapshots of this page…" rows={2} />;
  if (list.length === 0) {
    return (
      <Empty
        title="No snapshot of this page yet"
        detail="Click “Show on the page” above. On the page that opens, click “Save snapshot to Footprints” in the panel: the snapshot appears here, ready to analyse."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
        <Dropdown
          label="Snapshot"
          value={selectedId ?? ""}
          options={list.map((s) => ({ value: s.id, label: `${new Date(s.createdTime).toLocaleString()} · ${s.device}` }))}
          onChange={(id) => setSelectedId(id)}
        />
        {meta &&
          (confirmDelete ? (
            <span style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
              <span style={{ fontSize: 14 }}>Delete this snapshot?</span>
              <button type="button" onClick={remove} style={dangerButton}>
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
          ))}
      </div>

      {saveError && <ErrorNotice title="Could not save your change" detail={saveError} />}
      {loadError && <ErrorNotice title="Could not open this snapshot" detail={loadError} />}
      {elements.error && <ErrorNotice title="Could not load the clicks" detail={elements.error} />}
      {(!snapshot || elements.loading) && !loadError && <Loading label="Preparing the page map…" rows={3} />}
      {snapshot && elements.data && !elements.loading && (
        <SnapshotView
          snapshot={snapshot}
          elements={elements.data}
          scroll={scroll.data && scroll.data.visits ? scroll.data : null}
          pageVisits={props.pageVisits}
          deviceKey={filters.device}
          saving={saving}
          onRename={rename}
        />
      )}
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

const dangerButton = { ...plainButton, border: "1px solid #9A3412", color: "#9A3412" } as const;
