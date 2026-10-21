/**
 * Page picker: a searchable, scrollable list of every page plus the user's
 * page groups, and an editor to build a group from rules with dropdowns
 * ("Path is exactly /", "Query parameters contain utm_").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { FormField, Label, Select, TextInput } from "@dynatrace/strato-components/forms";
import { Heading as StratoHeading } from "@dynatrace/strato-components/typography";
import { PlusIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { Filters, PAGE_LIMIT, PageRule, validRules } from "../dql/queries";
import { PageSummary, searchPages, useScopePages } from "../hooks/data";
import { formatInt } from "../lib/format";
import { pageHost } from "../lib/labels";
import { describeRules, pageChoice, PageChoice, PageGroup, pageName, RULE_OPS, URL_PARTS } from "../lib/pages";
import { c } from "../theme";

export function PagePicker(props: {
  filters: Filters | null;
  choices: PageChoice[];
  /** All pages were loaded (fewer than PAGE_LIMIT): searching needs no query. */
  complete: boolean;
  value: string;
  current: PageChoice | null;
  loading: boolean;
  onChange: (choice: PageChoice) => void;
  onNewGroup: () => void;
  onEditGroup: (group: PageGroup) => void;
  /** Called when the list opens: pages are loaded only when needed. */
  onOpen?: () => void;
  label?: string;
  /** Offers an empty choice with this text (e.g. "No goal"). */
  noneLabel?: string;
  onClear?: () => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<{ text: string; pages: PageSummary[] | null; error: string | null } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();

  // More pages than the list holds: ask Dynatrace for every page containing the text.
  useEffect(() => {
    if (!open || props.complete || !props.filters || q.length < 2) {
      setRemote(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRemote({ text: q, pages: null, error: null });
      searchPages(props.filters!, q, controller.signal).then(
        (pages) => !controller.signal.aborted && setRemote({ text: q, pages, error: null }),
        (e: unknown) => !controller.signal.aborted && setRemote({ text: q, pages: null, error: e instanceof Error ? e.message : String(e) }),
      );
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, q, props.complete, props.filters]);

  const filtered = useMemo(() => {
    const local = q ? props.choices.filter((ch) => ch.label.toLowerCase().includes(q) || ch.key.toLowerCase().includes(q)) : props.choices;
    if (!remote?.pages || remote.text !== q) return local;
    const have = new Set(local.map((ch) => ch.key));
    const multiHost = new Set(remote.pages.map((p) => pageHost(p.url))).size > 1;
    const extra = remote.pages.filter((p) => !have.has(p.url)).map((p) => pageChoice(p, multiHost));
    return [...local, ...extra].sort((a, b) => (a.kind === b.kind ? (b.visits ?? 0) - (a.visits ?? 0) : a.kind === "group" ? -1 : 1));
  }, [props.choices, q, remote]);
  const groups = filtered.filter((ch) => ch.kind === "group");
  const pages = filtered.filter((ch) => ch.kind === "page");
  const pageCount = props.choices.filter((ch) => ch.kind === "page").length;

  function pick(ch: PageChoice) {
    props.onChange(ch);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={boxRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6, flex: "1 1 340px", minWidth: 0 }}>
      <Label>{props.label ?? "Page"}</Label>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) props.onOpen?.();
          setOpen((o) => !o);
        }}
        style={{
          minHeight: 32,
          padding: "0 10px",
          borderRadius: 6,
          border: `1px solid ${c.line}`,
          background: c.surface,
          color: c.ink,
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {props.current ? describe(props.current) : props.placeholder ?? "Choose a page"}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a page"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 6,
            zIndex: 30,
            background: c.surface,
            border: `1px solid ${c.line}`,
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(22,25,31,0.2)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minWidth: 340,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to filter, e.g. product or checkout"
              aria-label="Search pages and groups"
              style={{ flex: 1, minWidth: 0, minHeight: 32, padding: "0 10px", borderRadius: 6, border: `1px solid ${c.line}`, background: c.surface, color: c.ink }}
            />
            <Button
              variant="emphasized"
              color="primary"
              onClick={() => {
                setOpen(false);
                props.onNewGroup();
              }}
            >
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              New group
            </Button>
          </div>
          <div style={{ fontSize: 12, color: c.muted, padding: "0 2px" }}>
            {props.loading
              ? ""
              : props.complete
              ? `${formatInt(pageCount)} pages with clicks in the last 7 days`
              : `The ${formatInt(PAGE_LIMIT)} most visited pages are listed; typing searches all of them.`}
            {remote && remote.text === q && !remote.pages && !remote.error && " Searching…"}
            {remote?.error && " The search failed: showing listed pages only."}
          </div>
          <div role="listbox" aria-label="Pages" style={{ overflow: "auto", maxHeight: 420, display: "flex", flexDirection: "column", gap: 2 }}>
            {props.noneLabel && props.onClear && !q && (
              <button
                type="button"
                role="option"
                aria-selected={!props.current}
                onClick={() => {
                  props.onClear!();
                  setOpen(false);
                }}
                style={{ minHeight: 38, padding: "0 10px", border: 0, borderRadius: 8, background: !props.current ? c.accentSoft : "transparent", color: c.ink, textAlign: "left", cursor: "pointer", fontStyle: "italic" }}
              >
                {props.noneLabel}
              </button>
            )}
            {groups.length > 0 && <Heading>Your page groups</Heading>}
            {groups.map((ch) => (
              <Row key={ch.key} choice={ch} selected={ch.key === props.value} onPick={pick} onEdit={() => ch.group && (setOpen(false), props.onEditGroup(ch.group))} />
            ))}
            {pages.length > 0 && <Heading>Pages</Heading>}
            {pages.map((ch) => (
              <Row key={ch.key} choice={ch} selected={ch.key === props.value} onPick={pick} />
            ))}
            {props.loading && <div style={{ padding: "8px 10px", fontSize: 14, color: c.muted }}>Loading the pages of this application…</div>}
            {!props.loading && filtered.length === 0 && !(remote && !remote.pages && !remote.error) && (
              <div style={{ padding: "8px 10px", fontSize: 14, color: c.muted }}>No page matches “{query}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function describe(ch: PageChoice): string {
  if (ch.kind === "group") return `${ch.label} — page group`;
  return ch.visits !== null ? `${ch.label} — ${formatInt(ch.visits)} visits` : ch.label;
}

function Heading(props: { children: string }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 1, background: c.surface, padding: "6px 10px 2px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: c.muted }}>
      {props.children}
    </div>
  );
}

function Row(props: { choice: PageChoice; selected: boolean; onPick: (ch: PageChoice) => void; onEdit?: () => void }) {
  const ch = props.choice;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 8, background: props.selected ? c.accentSoft : "transparent" }}>
      <button
        type="button"
        role="option"
        aria-selected={props.selected}
        onClick={() => props.onPick(ch)}
        title={ch.kind === "group" && ch.group ? describeRules(ch.group.rules) : ch.key}
        style={{ flex: 1, minWidth: 0, minHeight: 38, padding: "0 10px", border: 0, background: "transparent", color: c.ink, textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: ch.kind === "group" ? 700 : 500 }}>{ch.label}</span>
          {ch.kind === "group" && ch.group && (
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: c.muted }}>{describeRules(ch.group.rules)}</span>
          )}
        </span>
        {ch.visits !== null && <span style={{ color: c.muted, fontSize: 13, whiteSpace: "nowrap" }}>{formatInt(ch.visits)} visits</span>}
      </button>
      {props.onEdit && (
        <button
          type="button"
          aria-label={`Edit group ${ch.label}`}
          onClick={props.onEdit}
          style={{ width: 34, height: 34, flex: "none", borderRadius: 8, border: `1px solid ${c.line}`, background: c.surface, color: c.muted, cursor: "pointer" }}
        >
          ✎
        </button>
      )}
    </div>
  );
}

/** Create or edit a page group from rules, with a live preview of the pages it covers. */
export function GroupEditor(props: {
  group: PageGroup | null; // null: new group
  filters: Filters;
  saving: boolean;
  error: string | null;
  onSave: (group: Omit<PageGroup, "id"> & { id?: string }) => void;
  onDelete: (group: PageGroup) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.group?.name ?? "");
  const [rules, setRules] = useState<PageRule[]>(props.group?.rules.length ? props.group.rules : [{ part: "path", op: "contains", value: "" }]);
  const usable = validRules(rules);

  // Preview, asked to Dynatrace a moment after the rules stop changing.
  const [previewRules, setPreviewRules] = useState<PageRule[]>(usable);
  const usableKey = JSON.stringify(usable);
  useEffect(() => {
    const t = window.setTimeout(() => setPreviewRules(JSON.parse(usableKey)), 600);
    return () => window.clearTimeout(t);
  }, [usableKey]);
  const preview = useScopePages(props.filters, previewRules.length ? { kind: "group", rules: previewRules } : null, 0);
  const previewCurrent = JSON.stringify(previewRules) === usableKey;

  const valid = name.trim().length > 0 && usable.length > 0;

  function update(i: number, patch: Partial<PageRule>) {
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <section aria-label="Page group" style={{ background: c.surface, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
      <StratoHeading level={4}>{props.group ? "Edit page group" : "New page group"}</StratoHeading>
      <div style={{ maxWidth: 420 }}>
        <FormField>
          <Label>Name</Label>
          <TextInput value={name} onChange={(v) => setName(v)} maxLength={60} placeholder="e.g. Product pages, Home page, Newsletter visits" />
        </FormField>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: c.muted }}>Pages where</span>
        {rules.map((r, i) => {
          const part = URL_PARTS.find((p) => p.value === r.part);
          return (
            <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {i > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: c.muted, minWidth: 30 }}>and</span>}
              <Select<PageRule["part"]> aria-label="Part of the address" value={r.part} onChange={(v) => v && update(i, { part: v })}>
                <Select.Content>
                  {URL_PARTS.map((p) => (
                    <Select.Option key={p.value} value={p.value}>
                      {p.label}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
              <Select<PageRule["op"]> aria-label="Rule" value={r.op} onChange={(v) => v && update(i, { op: v })}>
                <Select.Content>
                  {RULE_OPS.map((o) => (
                    <Select.Option key={o.value} value={o.value}>
                      {o.label}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
              <div style={{ flex: "1 1 200px", minWidth: 160 }}>
                <TextInput aria-label="Text" value={r.value} onChange={(v) => update(i, { value: v })} placeholder={part?.example} />
              </div>
              {rules.length > 1 && (
                <Button aria-label="Remove this rule" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                  <Button.Prefix>
                    <XmarkIcon />
                  </Button.Prefix>
                </Button>
              )}
            </div>
          );
        })}
        <div>
          <Button onClick={() => setRules((rs) => [...rs, { part: "query", op: "contains", value: "" }])}>
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add a rule
          </Button>
        </div>
        <div style={{ fontSize: 13, color: c.muted }}>
          Examples: <em>Path is exactly “/”</em> for the home page · <em>Path contains “/product/”</em> for every product page ·{" "}
          <em>Query parameters contain “utm_source=newsletter”</em> for visits from the newsletter.
        </div>
      </div>

      <div aria-live="polite" style={{ fontSize: 14, padding: "10px 12px", borderRadius: 10, background: c.surfaceAlt }}>
        {usable.length === 0 ? (
          <span style={{ color: c.muted }}>Fill in a rule to see which pages it covers.</span>
        ) : preview.error ? (
          <span>Could not check the rules: {preview.error}</span>
        ) : preview.loading || !previewCurrent || !preview.data ? (
          <span style={{ color: c.muted }}>Checking which pages match…</span>
        ) : preview.data.length === 0 ? (
          <span>No page with clicks matches in this period.</span>
        ) : (
          <>
            <strong>
              {preview.data.length >= PAGE_LIMIT ? `More than ${formatInt(PAGE_LIMIT)}` : formatInt(preview.data.length)} page{preview.data.length === 1 ? "" : "s"}
            </strong>{" "}
            match, for example:
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {preview.data.slice(0, 5).map((p) => (
                <li key={p.url}>
                  {pageName(p.url)} <span style={{ color: c.muted }}>· {formatInt(p.visits)} visits</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {props.error && <div role="alert" style={{ padding: "10px 12px", borderRadius: 10, background: c.warnSoft, color: c.warnInk }}>{props.error}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button
          variant="accent"
          color="primary"
          disabled={!valid}
          loading={props.saving}
          onClick={() => props.onSave({ id: props.group?.id, appId: props.filters.appId, name: name.trim(), rules: usable.map((r) => ({ ...r, value: r.value.trim() })) })}
        >
          Save group
        </Button>
        <Button onClick={props.onCancel}>Cancel</Button>
        {props.group && (
          <div style={{ marginLeft: "auto" }}>
            <Button color="critical" onClick={() => props.group && props.onDelete(props.group)}>
              Delete group
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
