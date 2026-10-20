/**
 * Page picker: a searchable list of page groups and pages, and a small editor
 * to create a group with dropdowns ("pages whose address contains /product/").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageSummary } from "../hooks/data";
import { formatInt } from "../lib/format";
import { pageLabel } from "../lib/labels";
import { groupMatches, PAGE_OPS, PageChoice, PageGroup, PageOp } from "../lib/pages";
import { c } from "../theme";

const MAX_SHOWN = 60;

export function PagePicker(props: {
  choices: PageChoice[];
  value: string;
  loading: boolean;
  onChange: (key: string) => void;
  onNewGroup: () => void;
  onEditGroup: (group: PageGroup) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = props.choices.find((ch) => ch.key === props.value) ?? null;

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
  const filtered = useMemo(
    () => (q ? props.choices.filter((ch) => ch.label.toLowerCase().includes(q) || ch.key.toLowerCase().includes(q)) : props.choices),
    [props.choices, q],
  );
  const groups = filtered.filter((ch) => ch.kind === "group");
  const pages = filtered.filter((ch) => ch.kind === "page");

  function pick(key: string) {
    props.onChange(key);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={boxRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6, flex: "1 1 320px", minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: c.muted }}>Page</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={props.loading && props.choices.length === 0}
        style={{
          minHeight: 44,
          padding: "0 12px",
          borderRadius: 10,
          border: `1px solid ${c.lineStrong}`,
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
          {current ? describe(current) : props.loading ? "Loading pages…" : "Choose a page"}
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
            maxHeight: 460,
            minWidth: 320,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages and groups"
              aria-label="Search pages and groups"
              style={{ flex: 1, minWidth: 0, minHeight: 40, padding: "0 10px", borderRadius: 8, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.ink }}
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                props.onNewGroup();
              }}
              style={{ minHeight: 40, padding: "0 12px", borderRadius: 8, border: `1px solid ${c.ink}`, background: c.ink, color: c.surface, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              + New group
            </button>
          </div>
          <div role="listbox" aria-label="Pages" style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {groups.length > 0 && <Heading>Page groups</Heading>}
            {groups.map((ch) => (
              <Row key={ch.key} choice={ch} selected={ch.key === props.value} onPick={pick} onEdit={() => ch.group && (setOpen(false), props.onEditGroup(ch.group))} />
            ))}
            {pages.length > 0 && <Heading>Pages</Heading>}
            {pages.slice(0, MAX_SHOWN).map((ch) => (
              <Row key={ch.key} choice={ch} selected={ch.key === props.value} onPick={pick} />
            ))}
            {pages.length > MAX_SHOWN && (
              <div style={{ padding: "8px 10px", fontSize: 13, color: c.muted }}>
                {formatInt(pages.length - MAX_SHOWN)} more pages — type to narrow the list, or group them.
              </div>
            )}
            {filtered.length === 0 && <div style={{ padding: "8px 10px", fontSize: 14, color: c.muted }}>No page matches “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function describe(ch: PageChoice): string {
  if (ch.kind === "group") return `${ch.label} — group of ${formatInt(ch.templates.length)} page${ch.templates.length === 1 ? "" : "s"}`;
  return `${ch.label} — ${formatInt(ch.visits ?? 0)} visits`;
}

function Heading(props: { children: string }) {
  return <div style={{ padding: "6px 10px 2px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: c.muted }}>{props.children}</div>;
}

function Row(props: { choice: PageChoice; selected: boolean; onPick: (key: string) => void; onEdit?: () => void }) {
  const ch = props.choice;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 8, background: props.selected ? c.accentSoft : "transparent" }}>
      <button
        type="button"
        role="option"
        aria-selected={props.selected}
        onClick={() => props.onPick(ch.key)}
        style={{ flex: 1, minWidth: 0, minHeight: 38, padding: "0 10px", border: 0, background: "transparent", color: c.ink, textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10 }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: ch.kind === "group" ? 700 : 500 }}>{ch.label}</span>
        <span style={{ color: c.muted, fontSize: 13, whiteSpace: "nowrap" }}>
          {ch.kind === "group" ? `${formatInt(ch.templates.length)} pages` : `${formatInt(ch.visits ?? 0)} visits`}
        </span>
      </button>
      {props.onEdit && (
        <button
          type="button"
          aria-label={`Edit group ${ch.label}`}
          onClick={props.onEdit}
          style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${c.line}`, background: c.surface, color: c.muted, cursor: "pointer" }}
        >
          ✎
        </button>
      )}
    </div>
  );
}

/** Create or edit a page group with dropdowns, with a live preview of the pages it covers. */
export function GroupEditor(props: {
  group: PageGroup | null; // null: new group
  appId: string;
  pages: PageSummary[];
  saving: boolean;
  error: string | null;
  onSave: (group: Omit<PageGroup, "id"> & { id?: string }) => void;
  onDelete: (group: PageGroup) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.group?.name ?? "");
  const [op, setOp] = useState<PageOp>(props.group?.op ?? "contains");
  const [value, setValue] = useState(props.group?.value ?? "");
  const matched = useMemo(() => (value.trim() ? props.pages.filter((p) => groupMatches({ op, value }, p.url)) : []), [props.pages, op, value]);
  const valid = name.trim().length > 0 && value.trim().length > 0;

  const field = { minHeight: 44, padding: "0 12px", borderRadius: 10, border: `1px solid ${c.lineStrong}`, background: c.surface, color: c.ink } as const;

  return (
    <section aria-label="Page group" style={{ background: c.surface, border: `2px solid ${c.accent}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{props.group ? "Edit page group" : "New page group"}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: c.muted, flex: "1 1 220px" }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Product pages" style={field} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "2 1 380px" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.muted }}>Pages whose address</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select aria-label="Rule" value={op} onChange={(e) => setOp(e.target.value as PageOp)} style={field}>
              {PAGE_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input aria-label="Text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="/product/" style={{ ...field, flex: 1, minWidth: 160 }} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: 14 }}>
        {value.trim() ? (
          <>
            <strong>{formatInt(matched.length)}</strong> page{matched.length === 1 ? "" : "s"} match
            {matched.length > 0 && <span style={{ color: c.muted }}>: {matched.slice(0, 5).map((p) => pageLabel(p.url)).join(", ")}{matched.length > 5 ? "…" : ""}</span>}
          </>
        ) : (
          <span style={{ color: c.muted }}>Type a piece of the address, e.g. <code>/product/</code>, or <code>/</code> with “is exactly” for the home page.</span>
        )}
      </div>
      {props.error && <div role="alert" style={{ padding: "10px 12px", borderRadius: 10, background: c.warnSoft, color: c.warnInk }}>{props.error}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={!valid || props.saving}
          onClick={() => props.onSave({ id: props.group?.id, appId: props.appId, name: name.trim(), op, value: value.trim() })}
          style={{ ...field, border: `1px solid ${c.ink}`, background: c.ink, color: c.surface, fontWeight: 700, cursor: valid ? "pointer" : "not-allowed", opacity: valid ? 1 : 0.5 }}
        >
          {props.saving ? "Saving…" : "Save group"}
        </button>
        <button type="button" onClick={props.onCancel} style={{ ...field, fontWeight: 600, cursor: "pointer" }}>
          Cancel
        </button>
        {props.group && (
          <button type="button" onClick={() => props.group && props.onDelete(props.group)} style={{ ...field, border: "1px solid #9A3412", color: "#9A3412", fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
            Delete group
          </button>
        )}
      </div>
    </section>
  );
}
