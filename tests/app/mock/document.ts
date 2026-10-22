/** Stand-in for @dynatrace-sdk/client-document: documents kept in memory (window.__docs). */
interface Doc {
  id: string;
  version: string;
  name: string;
  type: string;
  description?: string;
  content: unknown;
  modificationInfo: { createdTime: string };
}
declare global {
  interface Window {
    __docs: Doc[];
    __downloads: string[];
  }
}
let created = 100;
const meta = (d: Doc) => ({ id: d.id, version: d.version, name: d.name, type: d.type, description: d.description, modificationInfo: d.modificationInfo });
async function read(blob: Blob) {
  // JSON documents are kept as objects (tests read them); pictures as blobs.
  return blob.type.includes("json") ? JSON.parse(await blob.text()) : blob;
}
export const documentsClient = {
  async listDocuments(config: { filter: string }) {
    const type = /type == '([^']+)'/.exec(config.filter)?.[1];
    return { documents: window.__docs.filter((d) => d.type === type).map(meta), nextPageKey: undefined };
  },
  async getDocumentMetadata(config: { id: string }) {
    const d = window.__docs.find((x) => x.id === config.id);
    if (!d) throw new Error("not found");
    return meta(d);
  },
  async downloadDocumentContent(config: { id: string }) {
    const d = window.__docs.find((x) => x.id === config.id);
    if (!d) throw new Error("not found");
    (window.__downloads ??= []).push(d.id);
    let content = d.content;
    if (typeof content === "string" && content.startsWith("data:")) {
      const [head, body] = content.split(",");
      const bytes = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
      content = new Blob([bytes], { type: head.slice(5).split(";")[0] });
    }
    return {
      get: async (type?: string) => {
        if (type === "blob") return content instanceof Blob ? content : new Blob([JSON.stringify(content)], { type: "application/json" });
        return content;
      },
    };
  },
  async createDocument(config: { body: { name: string; type: string; description?: string; content: Blob } }) {
    const d: Doc = {
      id: `doc-${++created}`,
      version: "1",
      name: config.body.name,
      type: config.body.type,
      description: config.body.description,
      content: await read(config.body.content),
      modificationInfo: { createdTime: new Date().toISOString() },
    };
    window.__docs.unshift(d);
    return meta(d);
  },
  async updateDocumentContent(config: { id: string; optimisticLockingVersion: string; body: { content: Blob } }) {
    const d = window.__docs.find((x) => x.id === config.id)!;
    await new Promise((r) => setTimeout(r, 150)); // a save takes a moment, like the real one
    if (config.optimisticLockingVersion !== d.version) {
      throw new Error(`Request failed: {"error":{"code":409,"message":"Expected to find document ${d.id} with version ${config.optimisticLockingVersion} but actual version is ${d.version}"}}`);
    }
    d.content = await read(config.body.content);
    d.version = String(Number(d.version) + 1);
    return meta(d);
  },
  async updateDocumentMetadata() {
    throw new Error('Request failed: {"error":{"code":405,"message":"Method Not Allowed"}}'); // as on Dynatrace
  },
  async updateDocument(config: { id: string; optimisticLockingVersion: string; body: { name?: string; content?: Blob } }) {
    const d = window.__docs.find((x) => x.id === config.id)!;
    if (config.optimisticLockingVersion !== d.version) throw new Error("409 version");
    if (config.body.name) d.name = config.body.name;
    if (config.body.content) d.content = await read(config.body.content);
    d.version = String(Number(d.version) + 1);
    return { documentMetadata: meta(d) };
  },
  async deleteDocument(config: { id: string }) {
    window.__docs = window.__docs.filter((x) => x.id !== config.id);
  },
};
