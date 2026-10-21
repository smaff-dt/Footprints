/**
 * Page snapshots, stored as Dynatrace documents.
 *
 * A snapshot is taken by the browser extension on the live page: a picture of
 * the whole page plus a map of its areas and elements (where they are, and the
 * keys to match them with recorded clicks). The numbers are not stored: the
 * app recomputes them on the map for whatever period, device and metric the
 * user picks.
 *
 * Documents are private to their owner by default.
 */
import { documentsClient } from "@dynatrace-sdk/client-document";

export const SNAPSHOT_TYPE = "footprints-snapshot";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapArea {
  id: string;
  /** Canonical DOM path, stable across snapshots of the same page. */
  key: string;
  box: Box;
  /** Name suggested from the page itself. */
  name: string;
}

export interface MapElement {
  /** Keys to match recorded xpaths: the raw xpath (JSON) when known, then canonical paths. */
  keys: string[];
  box: Box;
  name: string;
  /** Area ids, from the largest to the smallest. */
  chain: string[];
  content: { href: string; src: string; text: string };
}

export interface SnapshotMap {
  areas: MapArea[];
  elements: MapElement[];
  page: { w: number; h: number };
  detail: number;
}

export interface Snapshot {
  kind: "footprints-snapshot";
  v: 1;
  app: string;
  appId: string;
  page: string;
  url: string;
  title: string;
  device: string;
  viewport: { w: number; h: number };
  capturedAt: string;
  truncated: boolean;
  image: { dataUrl: string; width: number; height: number; scale: number };
  map: SnapshotMap;
  /** Names given by the user, by area key. */
  names: Record<string, string>;
  /**
   * Where the clicked elements are at the window widths visitors use most
   * (automatic snapshots): map element index → box, in page pixels.
   */
  layouts?: Layout[];
  /** "auto" for desktop and mobile snapshots taken in the background; "custom" otherwise. */
  capture?: "auto" | "custom";
}

export interface Layout {
  width: number;
  page: { w: number; h: number };
  boxes: Record<string, Box>;
}

export interface SnapshotMeta {
  id: string;
  version: string;
  name: string;
  createdTime: string;
  appId: string;
  pageHash: string;
  device: string;
  /** The page or page group, as shown to the user. */
  label: string;
  capture: "auto" | "custom";
}

/** Short, stable hash of a page template (FNV-1a, hex). */
export function pageHash(page: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < page.length; i++) {
    h ^= page.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Kept in the document's description, so the list of snapshots needs no download. */
interface Description {
  v: 1 | 2;
  a: string;
  p: string;
  d: string;
  /** v2: page label and capture kind. */
  l?: string;
  c?: "auto" | "custom";
}

function describe(s: Snapshot, label: string): string {
  const base: Description = { v: 2, a: s.appId.slice(0, 80), p: pageHash(s.page), d: s.device, c: s.capture === "auto" ? "auto" : "custom", l: "" };
  const room = 250 - JSON.stringify(base).length;
  return JSON.stringify({ ...base, l: label.slice(0, Math.max(0, room)) });
}

function parseDescription(text: string | undefined): Description | null {
  try {
    const d = JSON.parse(text ?? "") as Description;
    return d && (d.v === 1 || d.v === 2) ? d : null;
  } catch {
    return null;
  }
}

/** "Footprints · Home page · 2026-10-20 15:09" → "Home page" (snapshots saved before labels were kept). */
function labelFromName(name: string): string {
  const parts = name.split(" · ");
  return parts.length >= 3 ? parts.slice(1, -1).join(" · ") : name;
}

function metaOf(d: { id: string; version: string; name: string; description?: string; modificationInfo: { createdTime: Date | string } }): SnapshotMeta | null {
  const meta = parseDescription(d.description);
  if (!meta) return null;
  return {
    id: d.id,
    version: d.version,
    name: d.name,
    createdTime: new Date(d.modificationInfo.createdTime).toISOString(),
    appId: meta.a,
    pageHash: meta.p,
    device: meta.d,
    label: meta.l || labelFromName(d.name),
    capture: meta.c ?? "custom",
  };
}

export function isSnapshot(value: unknown): value is Snapshot {
  const s = value as Snapshot;
  return (
    !!s &&
    s.kind === "footprints-snapshot" &&
    typeof s.page === "string" &&
    !!s.image &&
    typeof s.image.dataUrl === "string" &&
    s.image.dataUrl.startsWith("data:image/") &&
    !!s.map &&
    Array.isArray(s.map.areas) &&
    Array.isArray(s.map.elements)
  );
}

function contentOf(s: Snapshot): Blob {
  return new Blob([JSON.stringify(s)], { type: "application/json" });
}

/** Saves a new snapshot; returns its document id. */
export async function saveSnapshot(s: Snapshot, label: string): Promise<string> {
  const when = new Date(s.capturedAt);
  const date = Number.isNaN(when.getTime()) ? s.capturedAt : when.toISOString().slice(0, 16).replace("T", " ");
  const doc = await documentsClient.createDocument({
    body: {
      name: `Footprints · ${label} · ${date}`.slice(0, 128),
      type: SNAPSHOT_TYPE,
      description: describe(s, label),
      content: contentOf(s),
    },
  });
  return doc.id;
}

/** Every snapshot of the user, newest first. */
export async function listAllSnapshots(): Promise<SnapshotMeta[]> {
  const out: SnapshotMeta[] = [];
  let pageKey: string | undefined;
  do {
    const res = await documentsClient.listDocuments({
      filter: `type == '${SNAPSHOT_TYPE}'`,
      addFields: "description",
      sort: "-modificationInfo.createdTime",
      pageSize: 1000,
      pageKey,
    });
    for (const d of res.documents) {
      const meta = metaOf(d);
      if (meta) out.push(meta);
    }
    pageKey = res.nextPageKey;
  } while (pageKey);
  return out;
}

export async function getSnapshotMeta(id: string): Promise<SnapshotMeta> {
  const d = await documentsClient.getDocumentMetadata({ id });
  const meta = metaOf(d);
  if (!meta) throw new Error("This document is not a Footprints snapshot.");
  return meta;
}

export async function loadSnapshot(id: string): Promise<Snapshot> {
  const binary = await documentsClient.downloadDocumentContent({ id });
  const data = await binary.get("json");
  if (!isSnapshot(data)) throw new Error("This document is not a Footprints snapshot.");
  return { ...data, names: data.names ?? {} };
}

/** Saves the names given to areas; returns the document's new version. */
export async function saveNames(meta: SnapshotMeta, snapshot: Snapshot, names: Record<string, string>): Promise<string> {
  const next: Snapshot = { ...snapshot, names };
  const res = await documentsClient.updateDocumentContent({
    id: meta.id,
    optimisticLockingVersion: meta.version,
    body: { content: contentOf(next) },
  });
  return res.version;
}

export async function deleteSnapshot(meta: SnapshotMeta): Promise<void> {
  await documentsClient.deleteDocument({ id: meta.id, optimisticLockingVersion: meta.version });
}
