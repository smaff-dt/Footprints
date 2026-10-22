/**
 * Small pictures of snapshots, for the list of snapshots.
 *
 * A snapshot document holds the picture of the whole page (often several
 * MB), so the list never downloads it. Each snapshot gets a second, tiny
 * document instead: the top of the page as a JPEG of about 10–30 KB. It is
 * made when the snapshot is saved, or the first time an older snapshot is
 * opened. The number of zones turned on is kept in its name, so the list can
 * show it without opening anything.
 *
 * Thumbnails are downloaded only for the cards on screen, a few at a time,
 * and kept in memory for as long as the app is open.
 *
 * Dynatrace apps have their own rules on what they may load: pictures are
 * shown from data URLs (blob URLs are blocked), and metadata is changed with
 * updateDocument (the older metadata endpoint answers 405).
 */
import { documentsClient } from "@dynatrace-sdk/client-document";
import type { Snapshot } from "./snapshots";

export const THUMB_TYPE = "footprints-thumbnail";

export interface ThumbInfo {
  docId: string;
  version: string;
  snapshotId: string;
  zones: number | null;
}

interface ThumbDescription {
  v: 1;
  /** The snapshot's document id. */
  s: string;
}

const nameFor = (zones: number) => `Footprints thumbnail · ${zones} ${zones === 1 ? "zone" : "zones"}`;

function zonesFromName(name: string): number | null {
  const m = /· (\d+) zones?$/.exec(name);
  return m ? Number(m[1]) : null;
}

function infoOf(d: { id: string; version: string; name: string; description?: string }): ThumbInfo | null {
  try {
    const desc = JSON.parse(d.description ?? "") as ThumbDescription;
    if (!desc || desc.v !== 1 || typeof desc.s !== "string") return null;
    return { docId: d.id, version: d.version, snapshotId: desc.s, zones: zonesFromName(d.name) };
  } catch {
    return null;
  }
}

/** What is known of each snapshot's thumbnail, by snapshot id. */
const known = new Map<string, ThumbInfo>();
let listed = false;

/** Every thumbnail of the user, by snapshot id. */
export async function listThumbnails(): Promise<Map<string, ThumbInfo>> {
  const out = new Map<string, ThumbInfo>();
  let pageKey: string | undefined;
  do {
    const res = await documentsClient.listDocuments({
      filter: `type == '${THUMB_TYPE}'`,
      addFields: "description",
      pageSize: 1000,
      pageKey,
    });
    for (const d of res.documents) {
      const info = infoOf(d);
      if (info && !out.has(info.snapshotId)) out.set(info.snapshotId, info);
    }
    pageKey = res.nextPageKey;
  } while (pageKey);
  known.clear();
  out.forEach((v, k) => known.set(k, v));
  listed = true;
  return out;
}

/** The top of the page, small: 400 px wide (200 px for phones), JPEG. */
export async function makeThumbnail(s: Snapshot): Promise<Blob> {
  const img = new Image();
  img.src = s.image.dataUrl;
  await img.decode();
  const phone = s.device === "mobile" || s.viewport.w < 768;
  const outW = phone ? 200 : 400;
  const srcW = img.naturalWidth;
  const srcH = Math.min(img.naturalHeight, Math.round(srcW * (phone ? 1.7 : 0.75)));
  const outH = Math.max(1, Math.round((outW * srcH) / srcW));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, outW, outH);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No thumbnail"))), "image/jpeg", 0.72));
}

// One change at a time per snapshot, so a thumbnail is never made twice.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(snapshotId: string, job: () => Promise<T>): Promise<T> {
  const next = (chains.get(snapshotId) ?? Promise.resolve()).catch(() => undefined).then(job);
  chains.set(snapshotId, next);
  return next;
}

/**
 * Makes sure the snapshot has a thumbnail showing the right number of zones.
 * Best effort: a failure only means the list shows no picture.
 */
export function syncThumbnail(snapshotId: string, snapshot: Snapshot, zones: number): Promise<void> {
  return serial(snapshotId, async () => {
    if (!listed) await listThumbnails();
    const have = known.get(snapshotId);
    if (!have) {
      const doc = await documentsClient.createDocument({
        body: {
          name: nameFor(zones),
          type: THUMB_TYPE,
          description: JSON.stringify({ v: 1, s: snapshotId } satisfies ThumbDescription),
          content: await makeThumbnail(snapshot),
        },
      });
      known.set(snapshotId, { docId: doc.id, version: doc.version, snapshotId, zones });
      return;
    }
    if (have.zones === zones) return;
    const update = (version: string) =>
      documentsClient.updateDocument({ id: have.docId, optimisticLockingVersion: version, body: { name: nameFor(zones) } });
    let doc;
    try {
      doc = await update(have.version);
    } catch {
      const fresh = await documentsClient.getDocumentMetadata({ id: have.docId });
      doc = await update(fresh.version);
    }
    known.set(snapshotId, { ...have, version: doc.documentMetadata.version, zones });
  }).catch(() => undefined);
}

/** Deletes a snapshot's thumbnail (best effort). */
export function deleteThumbnail(snapshotId: string): Promise<void> {
  return serial(snapshotId, async () => {
    if (!listed) await listThumbnails();
    const have = known.get(snapshotId);
    if (!have) return;
    known.delete(snapshotId);
    pictures.delete(have.docId);
    await documentsClient.deleteDocument({ id: have.docId, optimisticLockingVersion: have.version });
  }).catch(() => undefined);
}

// ── Downloading the pictures: a few at a time, each once ─────────────────────
const pictures = new Map<string, Promise<string>>();
const MAX_AT_ONCE = 4;
let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * The thumbnail as a data URL (Dynatrace apps may show pictures from data
 * URLs, not from blob URLs).
 */
export function thumbnailUrl(docId: string): Promise<string> {
  let p = pictures.get(docId);
  if (!p) {
    p = slot(async () => {
      const binary = await documentsClient.downloadDocumentContent({ id: docId });
      const blob = await binary.get("blob");
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read the thumbnail"));
        reader.readAsDataURL(blob);
      });
    });
    p.catch(() => pictures.delete(docId));
    pictures.set(docId, p);
  }
  return p;
}
