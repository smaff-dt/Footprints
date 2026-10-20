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
}

export interface SnapshotMeta {
  id: string;
  version: string;
  name: string;
  createdTime: string;
  appId: string;
  pageHash: string;
  device: string;
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

interface Description {
  v: 1;
  a: string;
  p: string;
  d: string;
}

function describe(s: Snapshot): string {
  const d: Description = { v: 1, a: s.appId.slice(0, 120), p: pageHash(s.page), d: s.device };
  return JSON.stringify(d).slice(0, 256);
}

function parseDescription(text: string | undefined): Description | null {
  try {
    const d = JSON.parse(text ?? "") as Description;
    return d && d.v === 1 ? d : null;
  } catch {
    return null;
  }
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
      description: describe(s),
      content: contentOf(s),
    },
  });
  return doc.id;
}

/** Snapshots of one page of one application, newest first. */
export async function listSnapshots(appId: string, page: string): Promise<SnapshotMeta[]> {
  const hash = pageHash(page);
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
      const meta = parseDescription(d.description);
      if (!meta || meta.p !== hash || meta.a !== appId.slice(0, 120)) continue;
      out.push({
        id: d.id,
        version: d.version,
        name: d.name,
        createdTime: new Date(d.modificationInfo.createdTime).toISOString(),
        appId: meta.a,
        pageHash: meta.p,
        device: meta.d,
      });
    }
    pageKey = res.nextPageKey;
  } while (pageKey);
  return out;
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
