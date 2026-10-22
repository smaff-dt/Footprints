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
import { Button } from "@dynatrace/strato-components/buttons";
import { AppHeader } from "@dynatrace/strato-components/layouts";
import { RefreshIcon } from "@dynatrace/strato-icons";
import { GroupEditor } from "./components/PagePicker";
import { ErrorNotice } from "./components/States";
import { useApplications } from "./hooks/data";
import { useSnapshotInbox } from "./lib/extension";
import { labelForKey, loadGroups, newGroupId, PageGroup, storeGroups, StoredGroups } from "./lib/pages";
import { saveSnapshot, Snapshot } from "./lib/snapshots";
import { syncThumbnail } from "./lib/thumbnails";
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
      // Its small picture for the list is made at once (in the background).
      void syncThumbnail(id, snapshot, snapshot.zoning?.zones.length ?? 0);
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

      <AppHeader>
        <AppHeader.NavItems>
          <AppHeader.AppNavLink as="button" appName="Footprints" onClick={() => setScreen({ kind: "snapshots" })} />
          <AppHeader.NavItem as="button" isSelected={screen.kind === "snapshots"} onClick={() => setScreen({ kind: "snapshots" })}>
            Snapshots
          </AppHeader.NavItem>
          {screen.kind === "analysis" && (
            <AppHeader.NavItem as="button" isSelected>
              Analysis
            </AppHeader.NavItem>
          )}
        </AppHeader.NavItems>
        <AppHeader.ActionItems>
          <AppHeader.ActionButton
            prefixIcon={<RefreshIcon />}
            showLabel
            onClick={() => {
              setRefreshKey((k) => k + 1);
              setListTick((t) => t + 1);
            }}
          >
            Refresh data
          </AppHeader.ActionButton>
        </AppHeader.ActionItems>
      </AppHeader>

      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "16px 24px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
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
          <div role="status" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 8px 8px 16px", borderRadius: 9, background: c.accentSoft, color: c.ink, fontWeight: 600 }}>
            {savedNote}
            <Button onClick={() => setSavedNote(null)} aria-label="Dismiss">
              OK
            </Button>
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

