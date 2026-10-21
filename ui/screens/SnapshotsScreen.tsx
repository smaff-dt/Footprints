/**
 * First screen: take a new snapshot (application, page or page group, then
 * desktop, mobile or by hand), and the list of snapshots already saved.
 * Pages are loaded only when the page picker is opened.
 */
import { useEffect, useMemo, useState } from "react";
import { FormField, Label, SearchInput } from "@dynatrace/strato-components/forms";
import { Heading } from "@dynatrace/strato-components/typography";
import { Card, Dropdown } from "../components/Controls";
import { PagePicker } from "../components/PagePicker";
import { ShowOnPage } from "../components/ShowOnPage";
import { Empty, ErrorNotice, Loading } from "../components/States";
import { Application, useScopePages } from "../hooks/data";
import { choiceForKey, usePageChoices } from "../hooks/pageChoices";
import type { QueryState } from "../hooks/useQuery";
import { deviceName, formatWhen } from "../lib/format";
import { PAGE_LIMIT } from "../dql/queries";
import type { PageGroup } from "../lib/pages";
import { listAllSnapshots, SnapshotMeta } from "../lib/snapshots";
import { usePersistentState } from "../lib/storage";
import { c } from "../theme";

export function SnapshotsScreen(props: {
  apps: QueryState<Application[]>;
  groups: PageGroup[];
  refreshKey: number;
  /** Changes when a snapshot was saved or deleted. */
  listTick: number;
  onOpen: (id: string) => void;
  onEditGroup: (group: PageGroup | null, appId: string, then: (key: string) => void) => void;
}) {
  const apps = props.apps.data ?? [];
  const [appId, setAppId] = usePersistentState("fp.appId", "");
  const [pageKey, setPageKey] = usePersistentState("fp.page", "");
  const [pagesWanted, setPagesWanted] = useState(false);

  useEffect(() => {
    if (apps.length > 0 && !apps.some((a) => a.id === appId)) setAppId(apps[0].id);
  }, [apps, appId, setAppId]);
  useEffect(() => setPagesWanted(false), [appId]);

  const validApp = apps.some((a) => a.id === appId) ? appId : null;
  const { filters, pages, choices } = usePageChoices(validApp, props.groups, pagesWanted, props.refreshKey);
  const current = choiceForKey(pageKey, choices, null);
  const currentOk = current && (current.kind === "page" || current.group?.appId === validApp) ? current : null;
  const groupPages = useScopePages(filters, currentOk?.kind === "group" ? currentOk.scope : null, props.refreshKey);
  const sampleUrl = currentOk?.kind === "group" ? groupPages.data?.[0]?.url ?? "" : currentOk?.key ?? "";
  const appName = apps.find((a) => a.id === validApp)?.name ?? "";

  return (
    <>
      <Card label="New snapshot" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Heading level={4}>New snapshot</Heading>
        <p style={{ margin: 0, color: c.muted }}>
          Choose a page, then take a snapshot: <strong style={{ color: c.ink }}>Desktop</strong> and <strong style={{ color: c.ink }}>Mobile</strong> are taken
          automatically in the background; <strong style={{ color: c.ink }}>Open the page</strong> lets you arrange it by hand first (cookies, menus, window size).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16 }}>
          <Dropdown
            label="Application"
            value={validApp ?? ""}
            placeholder={props.apps.loading ? "Loading applications…" : "Choose an application"}
            options={apps.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(id) => {
              setAppId(id);
              setPageKey("");
            }}
            disabled={apps.length === 0}
          />
          <PagePicker
            filters={filters}
            choices={choices}
            complete={!!pages.data && pages.data.length < PAGE_LIMIT}
            value={pageKey}
            current={currentOk}
            loading={pages.loading}
            onOpen={() => setPagesWanted(true)}
            onChange={(ch) => setPageKey(ch.key)}
            onNewGroup={() => validApp && props.onEditGroup(null, validApp, setPageKey)}
            onEditGroup={(g) => validApp && props.onEditGroup(g, validApp, setPageKey)}
          />
        </div>
        {props.apps.error && <ErrorNotice title="Could not load your applications" detail={props.apps.error} />}
        {pages.error && <ErrorNotice title="Could not load the pages" detail={pages.error} />}
        {filters && currentOk && sampleUrl && (
          <ShowOnPage
            key={`${filters.appId}|${currentOk.key}`}
            filters={{ ...filters, device: "desktop" }}
            page={currentOk.key}
            scope={currentOk.scope}
            sampleUrl={sampleUrl}
            appName={appName}
          />
        )}
        {currentOk?.kind === "group" && groupPages.data && groupPages.data.length === 0 && (
          <p style={{ margin: 0, color: c.muted }}>No page with clicks in the last 7 days matches this group.</p>
        )}
        {!currentOk && validApp && <p style={{ margin: 0, color: c.muted }}>Choose a page or a page group to take a snapshot of it.</p>}
      </Card>

      <SnapshotList apps={apps} tick={props.listTick} onOpen={props.onOpen} />
    </>
  );
}

function SnapshotList(props: { apps: Application[]; tick: number; onOpen: (id: string) => void }) {
  const [list, setList] = useState<SnapshotMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [app, setApp] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    listAllSnapshots().then(
      (l) => alive && setList(l),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [props.tick, retry]);

  const appName = (id: string) => props.apps.find((a) => a.id === id)?.name ?? id;
  const appsInList = useMemo(() => Array.from(new Set((list ?? []).map((s) => s.appId))), [list]);
  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter((s) => (!app || s.appId === app) && (!q || `${s.label} ${appName(s.appId)}`.toLowerCase().includes(q)));

  return (
    <Card label="Your snapshots" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Heading level={4}>Your snapshots</Heading>
      {error && <ErrorNotice title="Could not load your snapshots" detail={error} onRetry={() => setRetry((r) => r + 1)} />}
      {!list && !error && <Loading label="Loading your snapshots…" rows={3} />}
      {list && list.length === 0 && (
        <Empty title="No snapshot yet" detail="Take your first snapshot above: it opens here, ready to analyse, and stays in this list." />
      )}
      {list && list.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 260px" }}>
              <FormField>
                <Label>Search</Label>
                <SearchInput value={query} onChange={(v) => setQuery(v)} placeholder="Page or application" />
              </FormField>
            </div>
            {appsInList.length > 1 && (
              <Dropdown
                label="Application"
                value={app}
                options={[{ value: "", label: "All applications" }, ...appsInList.map((id) => ({ value: id, label: appName(id) }))]}
                onChange={setApp}
              />
            )}
          </div>
          <div role="list" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {shown.map((s) => (
              <button
                key={s.id}
                type="button"
                role="listitem"
                onClick={() => props.onOpen(s.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 9,
                  border: `1px solid ${c.line}`,
                  background: c.surface,
                  color: c.ink,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  <span style={{ display: "block", fontSize: 13, color: c.muted }}>
                    {appName(s.appId)} · {deviceName(s.device)} · {formatWhen(s.createdTime)} · {s.capture === "auto" ? "automatic" : "by hand"}
                  </span>
                </span>
                <span aria-hidden="true" style={{ color: c.muted, fontSize: 20 }}>
                  ›
                </span>
              </button>
            ))}
            {shown.length === 0 && <p style={{ margin: 0, color: c.muted }}>No snapshot matches.</p>}
          </div>
        </>
      )}
    </Card>
  );
}

