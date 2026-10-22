/**
 * First screen: the snapshots already saved, as a gallery of cards grouped
 * by application (the latest snapshot of each page first, older ones on
 * request), and "New snapshot", which opens a side panel: page, then how to
 * take it (desktop, mobile or by hand).
 *
 * The list downloads no snapshot: names, dates and zone counts come with the
 * list of documents, and each card's small picture is downloaded only when
 * the card is on screen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { SearchInput } from "@dynatrace/strato-components/forms";
import { Heading } from "@dynatrace/strato-components/typography";
import { DesktopIcon, ImageIcon, MobileIcon, PlusIcon } from "@dynatrace/strato-icons";
import { Dropdown, Segmented } from "../components/Controls";
import { PagePicker } from "../components/PagePicker";
import { ShowOnPage } from "../components/ShowOnPage";
import { SidePanel, Step } from "../components/SidePanel";
import { Empty, ErrorNotice, Loading } from "../components/States";
import { Application, useScopePages } from "../hooks/data";
import { choiceForKey, usePageChoices } from "../hooks/pageChoices";
import type { QueryState } from "../hooks/useQuery";
import { deviceName, formatRelative, formatWhen } from "../lib/format";
import { PAGE_LIMIT } from "../dql/queries";
import type { PageGroup } from "../lib/pages";
import { listAllSnapshots, SnapshotMeta } from "../lib/snapshots";
import { usePersistentState } from "../lib/storage";
import { listThumbnails, thumbnailUrl, ThumbInfo } from "../lib/thumbnails";
import { c } from "../theme";

type DeviceFilter = "all" | "desktop" | "mobile";

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
  const [sheet, setSheet] = useState(false);
  const [list, setList] = useState<SnapshotMeta[] | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, ThumbInfo>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    listAllSnapshots().then(
      (l) => alive && setList(l),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    // Thumbnails are a plus: without them the cards simply show no picture.
    listThumbnails().then(
      (t) => alive && setThumbs(t),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [props.listTick, retry]);

  const editGroup = (group: PageGroup | null, appId: string, then: (key: string) => void) => {
    // The group editor opens on the screen; the panel comes back once the group is saved.
    setSheet(false);
    props.onEditGroup(group, appId, (key) => {
      then(key);
      setSheet(true);
    });
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <Heading level={2}>Snapshots</Heading>
          <div style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>Pictures of your pages with what visitors did on them. Open one to analyse it.</div>
        </div>
        <Button variant="accent" color="primary" onClick={() => setSheet(true)}>
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          New snapshot
        </Button>
      </div>

      {error && <ErrorNotice title="Could not load your snapshots" detail={error} onRetry={() => setRetry((r) => r + 1)} />}
      {!list && !error && <Loading label="Loading your snapshots…" rows={3} />}
      {list && list.length === 0 && (
        <div style={{ border: `1px dashed ${c.lineStrong}`, borderRadius: 12, background: c.surface }}>
          <Empty title="No snapshot yet" detail="Take a snapshot of a page to see where its visitors click, how far they scroll and which zones lead to conversions." />
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 28 }}>
            <Button variant="accent" color="primary" onClick={() => setSheet(true)}>
              Take your first snapshot
            </Button>
          </div>
        </div>
      )}
      {list && list.length > 0 && <Gallery list={list} thumbs={thumbs} apps={apps} onOpen={props.onOpen} />}

      <SidePanel title="New snapshot" open={sheet} onClose={() => setSheet(false)}>
        <NewSnapshot apps={props.apps} groups={props.groups} refreshKey={props.refreshKey} onEditGroup={editGroup} />
      </SidePanel>
    </>
  );
}

/** The content of the "New snapshot" panel. */
function NewSnapshot(props: {
  apps: QueryState<Application[]>;
  groups: PageGroup[];
  refreshKey: number;
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
      <Step n={1} title="Choose the page">
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
        <div style={{ display: "flex" }}>
          <PagePicker
            label="Page or page group"
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
        {currentOk?.kind === "group" && groupPages.data && groupPages.data.length === 0 && (
          <p style={{ margin: 0, color: c.muted, fontSize: 13 }}>No page with clicks in the last 7 days matches this group.</p>
        )}
      </Step>
      <Step n={2} title="Choose how to take it">
        {filters && currentOk && sampleUrl ? (
          <ShowOnPage
            key={`${filters.appId}|${currentOk.key}`}
            filters={{ ...filters, device: "desktop" }}
            page={currentOk.key}
            scope={currentOk.scope}
            sampleUrl={sampleUrl}
            appName={appName}
          />
        ) : (
          <p style={{ margin: 0, color: c.muted, fontSize: 13 }}>Choose a page or a page group first.</p>
        )}
      </Step>
    </>
  );
}

/** Saved snapshots by application; the latest of each page and device first. */
function Gallery(props: { list: SnapshotMeta[]; thumbs: Map<string, ThumbInfo>; apps: Application[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [app, setApp] = usePersistentState("fp.listApp", "");
  const [device, setDevice] = usePersistentState<DeviceFilter>("fp.listDevice", "all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const appName = (id: string) => props.apps.find((a) => a.id === id)?.name ?? id;
  const appsInList = useMemo(() => Array.from(new Set(props.list.map((s) => s.appId))), [props.list]);
  const appOk = appsInList.includes(app) ? app : "";
  const ALL = "*all*";
  const q = query.trim().toLowerCase();
  const shown = props.list.filter(
    (s) =>
      (!appOk || s.appId === appOk) &&
      (device === "all" || (device === "mobile" ? s.device === "mobile" : s.device !== "mobile")) &&
      (!q || `${s.label} ${appName(s.appId)}`.toLowerCase().includes(q)),
  );
  const pagesShown = new Set(shown.map((s) => `${s.appId}|${s.label}`)).size;

  const sections = appsInList
    .map((id) => {
      const all = shown.filter((s) => s.appId === id);
      const seen = new Set<string>();
      const latest: SnapshotMeta[] = [];
      const older: SnapshotMeta[] = [];
      for (const s of all) {
        const key = `${s.label}|${s.device}`;
        (seen.has(key) ? older : latest).push(s);
        seen.add(key);
      }
      return { id, latest, older };
    })
    .filter((sec) => sec.latest.length > 0);

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: "0 1 320px", minWidth: 220 }}>
          <SearchInput value={query} onChange={(v) => setQuery(v)} placeholder="Search page or application" aria-label="Search snapshots" />
        </div>
        {appsInList.length > 1 && (
          <Dropdown
            label="Application"
            value={appOk || ALL}
            options={[{ value: ALL, label: "All applications" }, ...appsInList.map((id) => ({ value: id, label: appName(id) }))]}
            onChange={(v) => setApp(v === ALL ? "" : v)}
          />
        )}
        <Segmented<DeviceFilter>
          label="Device"
          value={device}
          onChange={setDevice}
          options={[
            { value: "all", label: "All" },
            { value: "desktop", label: "Desktop" },
            { value: "mobile", label: "Mobile" },
          ]}
        />
        <span style={{ flex: "1 1 0" }} />
        <span style={{ color: c.muted, fontSize: 13 }}>
          {shown.length} {shown.length === 1 ? "snapshot" : "snapshots"} · {pagesShown} {pagesShown === 1 ? "page" : "pages"}
        </span>
      </div>

      {sections.length === 0 && <p style={{ margin: 0, color: c.muted }}>No snapshot matches.</p>}
      {sections.map((sec) => {
        const open = expanded.has(sec.id) || !!q;
        const cards = open ? [...sec.latest, ...sec.older].sort((a, b) => b.createdTime.localeCompare(a.createdTime)) : sec.latest;
        return (
          <section key={sec.id} aria-label={appName(sec.id)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: c.muted }}>{appName(sec.id)}</h3>
            <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
              {cards.map((s) => (
                <li key={s.id}>
                  <SnapshotCard meta={s} thumb={props.thumbs.get(s.id) ?? null} onOpen={() => props.onOpen(s.id)} />
                </li>
              ))}
            </ul>
            {sec.older.length > 0 && !q && (
              <div>
                <Button
                  variant="default"
                  size="condensed"
                  onClick={() =>
                    setExpanded((cur) => {
                      const next = new Set(cur);
                      if (next.has(sec.id)) next.delete(sec.id);
                      else next.add(sec.id);
                      return next;
                    })
                  }
                >
                  {open ? "Show only the latest snapshots" : `Show ${sec.older.length} older ${sec.older.length === 1 ? "snapshot" : "snapshots"} of these pages`}
                </Button>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function SnapshotCard(props: { meta: SnapshotMeta; thumb: ThumbInfo | null; onOpen: () => void }) {
  const { meta, thumb } = props;
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const phone = meta.device === "mobile";

  // The picture is downloaded only once the card is on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || !thumb) return;
    let alive = true;
    thumbnailUrl(thumb.docId).then(
      (u) => alive && setUrl(u),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [visible, thumb?.docId]); // eslint-disable-line react-hooks/exhaustive-deps

  const zones = thumb?.zones ?? null;
  return (
    <button
      ref={ref}
      type="button"
      data-snapshot={meta.id}
      onClick={props.onOpen}
      title={`${meta.label} · ${deviceName(meta.device)} · ${formatWhen(meta.createdTime)}`}
      className="fp-card"
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 0,
        border: `1px solid ${c.line}`,
        borderRadius: 9,
        background: c.surface,
        color: c.ink,
        textAlign: "left",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true" style={{ height: 150, width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 12, background: c.surfaceAlt, overflow: "hidden" }}>
        {url ? (
          <img src={url} alt="" style={{ width: phone ? "34%" : "82%", height: "auto", display: "block", boxShadow: "0 1px 4px rgba(0,0,0,0.14)", background: "#FFFFFF" }} />
        ) : thumb && !failed ? (
          <span style={{ width: phone ? "34%" : "82%", height: 160, background: "#FFFFFF", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", animation: "fp-pulse 1.4s ease-in-out infinite" }} />
        ) : (
          <span style={{ alignSelf: "center", marginTop: -12, color: c.muted, fontSize: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <ImageIcon />
            <span style={{ fontSize: 12 }}>Open it once to get its picture here</span>
          </span>
        )}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px 12px", minWidth: 0, width: "100%" }}>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.muted }}>
          <span aria-hidden="true" style={{ display: "flex", fontSize: 14 }}>
            {phone ? <MobileIcon /> : <DesktopIcon />}
          </span>
          {deviceName(meta.device)} · {formatRelative(meta.createdTime)}
          {meta.capture === "custom" ? " · by hand" : ""}
        </span>
        {zones !== null && (
          <span style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <span style={chip}>{zones === 0 ? "No zones yet" : `${zones} ${zones === 1 ? "zone" : "zones"}`}</span>
          </span>
        )}
      </span>
    </button>
  );
}

const chip = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  padding: "0 8px",
  borderRadius: 999,
  background: c.surfaceAlt,
  fontSize: 12,
  color: c.ink,
} as const;
