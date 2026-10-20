/**
 * Pages and page groups.
 *
 * A "page" is a page template (identifiers in the path replaced by `*`, see
 * queries.ts). A "group" is a rule on the page's path — contains, starts
 * with, ends with, is — that the user creates with dropdowns; it covers every
 * page template the rule matches. Groups are saved in one private Dynatrace
 * document, so they follow the user from browser to browser.
 */
import { documentsClient } from "@dynatrace-sdk/client-document";
import type { PageSummary } from "../hooks/data";
import { pageHost, pageLabel, pagePath } from "./labels";

export type PageOp = "contains" | "starts" | "ends" | "is";

export const PAGE_OPS: { value: PageOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "starts", label: "starts with" },
  { value: "ends", label: "ends with" },
  { value: "is", label: "is exactly" },
];

export interface PageGroup {
  id: string;
  appId: string;
  name: string;
  op: PageOp;
  value: string;
}

/** What the user picked: one page, or a group of pages. */
export interface PageChoice {
  key: string; // the page template, or "group:<id>"
  kind: "page" | "group";
  label: string;
  templates: string[];
  /** A real address to open in the browser. */
  sample: string;
  /** For pages: visits in the period. Groups show their page count instead. */
  visits: number | null;
  group?: PageGroup;
}

const GROUP_PREFIX = "group:";

function normalisePath(path: string): string {
  const p = path.trim().toLowerCase();
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function groupMatches(group: Pick<PageGroup, "op" | "value">, template: string): boolean {
  const path = normalisePath(pagePath(template));
  const value = normalisePath(group.value);
  if (!value) return false;
  switch (group.op) {
    case "contains":
      return path.includes(value);
    case "starts":
      return path.startsWith(value.startsWith("/") ? value : `/${value}`);
    case "ends":
      return path.endsWith(value);
    case "is":
      return path === (value.startsWith("/") ? value : `/${value}`);
  }
}

export function choicesFor(pages: PageSummary[], groups: PageGroup[], appId: string): PageChoice[] {
  const multiHost = new Set(pages.map((p) => pageHost(p.url))).size > 1;
  const groupChoices: PageChoice[] = groups
    .filter((g) => g.appId === appId)
    .map((g) => {
      const matched = pages.filter((p) => groupMatches(g, p.url));
      return {
        key: `${GROUP_PREFIX}${g.id}`,
        kind: "group" as const,
        label: g.name,
        templates: matched.map((p) => p.url),
        sample: matched[0]?.sample ?? "",
        visits: null,
        group: g,
      };
    });
  const pageChoices: PageChoice[] = pages.map((p) => ({
    key: p.url,
    kind: "page" as const,
    label: `${pageLabel(p.url)}${multiHost ? ` (${pageHost(p.url)})` : ""}`,
    templates: [p.url],
    sample: p.sample,
    visits: p.visits,
  }));
  return [...groupChoices, ...pageChoices];
}

/** Label for a page or group key, for messages and document names. */
export function labelForKey(key: string, groups: PageGroup[]): string {
  if (key.startsWith(GROUP_PREFIX)) return groups.find((g) => `${GROUP_PREFIX}${g.id}` === key)?.name ?? "Page group";
  return pageLabel(key);
}

export function newGroupId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const GROUPS_TYPE = "footprints-page-groups";

interface GroupsDoc {
  v: 1;
  groups: PageGroup[];
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
  const data = (await binary.get("json")) as GroupsDoc;
  const groups = Array.isArray(data?.groups) ? data.groups.filter((g) => g && g.id && g.name && g.value) : [];
  return { groups, docId: doc.id, version: doc.version };
}

export async function storeGroups(current: StoredGroups, groups: PageGroup[]): Promise<StoredGroups> {
  const content = new Blob([JSON.stringify({ v: 1, groups } satisfies GroupsDoc)], { type: "application/json" });
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
