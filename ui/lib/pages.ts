/**
 * Pages and page groups.
 *
 * A "page" is one real address without its query string: every product page
 * is its own page. A "group" is a set of rules the user creates with
 * dropdowns — "path is exactly /", "path contains /product/", "query contains
 * utm_" — and covers every page that matches all of them. Rules are applied
 * by Dynatrace (see queries.ts), so groups work on any number of pages and
 * can use the query string. Groups are saved in one private Dynatrace
 * document, so they follow the user from browser to browser.
 */
import { documentsClient } from "@dynatrace-sdk/client-document";
import type { PageRule, PageScope, RuleOp, UrlPart } from "../dql/queries";
import type { PageSummary } from "../hooks/data";
import { pageHost, pagePath } from "./labels";

export const URL_PARTS: { value: UrlPart; label: string; example: string }[] = [
  { value: "path", label: "Path", example: "/product/" },
  { value: "query", label: "Query parameters", example: "utm_source=newsletter" },
  { value: "host", label: "Host", example: "shop.example.com" },
  { value: "address", label: "Full address", example: "https://shop.example.com/product/" },
];

export const RULE_OPS: { value: RuleOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "is", label: "is exactly" },
  { value: "starts", label: "starts with" },
  { value: "ends", label: "ends with" },
  { value: "not_contains", label: "does not contain" },
];

export interface PageGroup {
  id: string;
  appId: string;
  name: string;
  /** A page belongs to the group when it matches every rule. */
  rules: PageRule[];
}

/** What the user picked: one page, or a group of pages. */
export interface PageChoice {
  key: string; // the page address, or "group:<id>"
  kind: "page" | "group";
  label: string;
  scope: PageScope;
  /** For pages: visits in the period. */
  visits: number | null;
  group?: PageGroup;
}

const GROUP_PREFIX = "group:";

/** "/product/2ZYFJ3GM2N"; the home page is "/ (home page)". */
export function pageName(url: string): string {
  const path = pagePath(url);
  return path === "/" || path === "" ? "/ (home page)" : path;
}

/** "Path is exactly “/” and query contains “utm”". */
export function describeRules(rules: PageRule[]): string {
  return rules
    .map((r, i) => {
      const part = URL_PARTS.find((p) => p.value === r.part)?.label ?? r.part;
      const op = RULE_OPS.find((o) => o.value === r.op)?.label ?? r.op;
      return `${i === 0 ? part : part.toLowerCase()} ${op} “${r.value}”`;
    })
    .join(" and ");
}

export function choicesFor(pages: PageSummary[], groups: PageGroup[], appId: string): PageChoice[] {
  const multiHost = new Set(pages.map((p) => pageHost(p.url))).size > 1;
  const groupChoices: PageChoice[] = groups
    .filter((g) => g.appId === appId)
    .map((g) => ({ key: `${GROUP_PREFIX}${g.id}`, kind: "group" as const, label: g.name, scope: { kind: "group" as const, rules: g.rules }, visits: null, group: g }));
  return [...groupChoices, ...pages.map((p) => pageChoice(p, multiHost))];
}

export function pageChoice(p: PageSummary, withHost: boolean): PageChoice {
  return {
    key: p.url,
    kind: "page",
    label: `${pageName(p.url)}${withHost ? ` · ${pageHost(p.url)}` : ""}`,
    scope: { kind: "page", url: p.url },
    visits: p.visits,
  };
}

/** A page that is not among the loaded pages (picked from a search, or saved earlier). */
export function looseChoice(key: string): PageChoice | null {
  if (!key || key.startsWith(GROUP_PREFIX) || !/^https?:\/\//.test(key)) return null;
  return { key, kind: "page", label: `${pageName(key)} · ${pageHost(key)}`, scope: { kind: "page", url: key }, visits: null };
}

/** Label for a page or group key, for messages and document names. */
export function labelForKey(key: string, groups: PageGroup[]): string {
  if (key.startsWith(GROUP_PREFIX)) return groups.find((g) => `${GROUP_PREFIX}${g.id}` === key)?.name ?? "Page group";
  return pageName(key);
}

export function newGroupId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const GROUPS_TYPE = "footprints-page-groups";

interface GroupsDoc {
  v: 2;
  groups: PageGroup[];
}

/** Groups saved by version 1 had one rule on the path: {op, value}. */
function upgrade(g: any): PageGroup | null {
  if (!g || !g.id || !g.name) return null;
  if (Array.isArray(g.rules)) return { id: g.id, appId: g.appId, name: g.name, rules: g.rules.filter((r: any) => r && r.part && r.op) };
  if (g.op && typeof g.value === "string") return { id: g.id, appId: g.appId, name: g.name, rules: [{ part: "path", op: g.op, value: g.value }] };
  return null;
}

export interface StoredGroups {
  groups: PageGroup[];
  docId: string | null;
  version: string | null;
}

export async function loadGroups(): Promise<StoredGroups> {
  const res = await documentsClient.listDocuments({ filter: `type == '${GROUPS_TYPE}'`, pageSize: 10 });
  const doc = res.documents[0];
  if (!doc) return { groups: [], docId: null, version: null };
  const binary = await documentsClient.downloadDocumentContent({ id: doc.id });
  const data = (await binary.get("json")) as { groups?: unknown[] };
  const groups = Array.isArray(data?.groups) ? data.groups.map(upgrade).filter((g): g is PageGroup => g !== null) : [];
  return { groups, docId: doc.id, version: doc.version };
}

export async function storeGroups(current: StoredGroups, groups: PageGroup[]): Promise<StoredGroups> {
  const content = new Blob([JSON.stringify({ v: 2, groups } satisfies GroupsDoc)], { type: "application/json" });
  if (current.docId && current.version) {
    const meta = await documentsClient.updateDocumentContent({
      id: current.docId,
      optimisticLockingVersion: current.version,
      body: { content },
    });
    return { groups, docId: current.docId, version: meta.version };
  }
  const meta = await documentsClient.createDocument({
    body: { name: "Footprints · page groups", type: GROUPS_TYPE, content },
  });
  return { groups, docId: meta.id, version: meta.version };
}
