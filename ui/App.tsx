/**
 * Footprints – which parts of a page do visitors see and use?
 *
 * Two screens:
 * - Snapshots: take a new snapshot of a page (desktop, mobile, or by hand)
 *   and find the snapshots already saved;
 * - Analysis: one snapshot with its numbers (areas, click and scroll
 *   heatmaps, conversions), for the period chosen.
 */
import { useCallback, useEffect, useState } from "react";
import { GroupEditor } from "./components/PagePicker";
import { ErrorNotice } from "./components/States";
import { useApplications } from "./hooks/data";
import { useSnapshotInbox } from "./lib/extension";
import { labelForKey, loadGroups, newGroupId, PageGroup, storeGroups, StoredGroups } from "./lib/pages";
import { saveSnapshot, Snapshot } from "./lib/snapshots";
import { AnalysisScreen } from "./screens/AnalysisScreen";
import { SnapshotsScreen } from "./screens/SnapshotsScreen";
import { c, GLOBAL_CSS } from "./theme";

type Screen = { kind: "snapshots" } | { kind: "analysis"; id: string };

interface Editing {
  group: PageGroup | null;
  appId: string;
  /** Receives the key of the saved group (to select it). */
  then: (key: string) => void;
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "snapshots" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [listTick, setListTick] = useState(0);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [groups, setGroups] = useState<StoredGroups>({ groups: [], docId: null, version: null });
  const [groupsReady, setGroupsReady] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const apps = useApplications();

  // Page groups are kept in a private document.
  useEffect(() => {
    loadGroups()
      .then(setGroups, (e: unknown) => setGroupError(`Could not load your page groups: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setGroupsReady(true));
  }, []);

  const open = useCallback((id: string) => {
    setScreen({ kind: "analysis", id });
    window.scrollTo(0, 0);
  }, []);

  // Snapshots arriving from the browser extension are saved, then opened.
  const onSnapshot = useCallback(
    async (snapshot: Snapshot) => {
      const label = labelForKey(snapshot.page, groups.groups);
      const id = await saveSnapshot(snapshot, label);
      setListTick((t) => t + 1);
      setSavedNote(`Snapshot of “${label}” saved.`);
      open(id);
      return id;
    },
    [groups.groups, open],
  );
  useSnapshotInbox(onSnapshot);

  async function saveGroup(g: Omit<PageGroup, "id"> & { id?: string }) {
    if (!editing) return;
    setGroupSaving(true);
    setGroupError(null);
    try {
      const group: PageGroup = { ...g, id: g.id ?? newGroupId() };
      const next = g.id ? groups.groups.map((x) => (x.id === g.id ? group : x)) : [...groups.groups, group];
      setGroups(await storeGroups(groups, next));
      editing.then(`group:${group.id}`);
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

  const editGroup = useCallback((group: PageGroup | null, appId: string, then: (key: string) => void) => {
    setGroupError(null);
    setEditing({ group, appId, then });
    window.scrollTo(0, 0);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: c.ground, color: c.ink }}>
      <style>{GLOBAL_CSS}</style>

      <header style={{ background: c.surface, borderBottom: `1px solid ${c.line}` }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "12px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <button
            type="button"
            onClick={() => setScreen({ kind: "snapshots" })}
            style={{ display: "flex", alignItems: "center", gap: 12, border: 0, background: "transparent", color: c.ink, padding: 0, cursor: "pointer", textAlign: "left" }}
          >
            <Logo />
            <span>
              <span style={{ display: "block", fontWeight: 800, fontSize: 18, letterSpacing: "-0.01em" }}>Footprints</span>
              <span style={{ display: "block", fontSize: 13, color: c.muted }}>Which parts of your pages do visitors use?</span>
            </span>
          </button>
          {screen.kind === "analysis" && (
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              style={{ minHeight: 44, padding: "0 16px", borderRadius: 10, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.ink, fontWeight: 600, cursor: "pointer" }}
            >
              Refresh data
            </button>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {editing && (
          <GroupEditor
            key={editing.group?.id ?? "new"}
            group={editing.group}
            filters={{ appId: editing.appId, timeframe: "7d", device: "all" }}
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

        {screen.kind === "snapshots" && (
          <SnapshotsScreen apps={apps} groups={groups.groups} refreshKey={refreshKey} listTick={listTick} onOpen={open} onEditGroup={editGroup} />
        )}
        {screen.kind === "analysis" && (
          <AnalysisScreen
            key={screen.id}
            id={screen.id}
            apps={apps.data ?? []}
            groups={groups.groups}
            groupsReady={groupsReady}
            refreshKey={refreshKey}
            onEditGroup={editGroup}
            onBack={(changed) => {
              if (changed) setListTick((t) => t + 1);
              setSavedNote(null);
              setScreen({ kind: "snapshots" });
            }}
          />
        )}
      </main>
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
