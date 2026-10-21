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
  }
}
const meta = (d: Doc) => ({ id: d.id, version: d.version, name: d.name, type: d.type, description: d.description, modificationInfo: d.modificationInfo });
async function read(blob: Blob) {
  return JSON.parse(await blob.text());
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
    return { get: async () => d.content };
  },
  async createDocument(config: { body: { name: string; type: string; description?: string; content: Blob } }) {
    const d: Doc = {
      id: `doc-${window.__docs.length + 1}`,
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
  async updateDocumentContent(config: { id: string; body: { content: Blob } }) {
    const d = window.__docs.find((x) => x.id === config.id)!;
    d.content = await read(config.body.content);
    d.version = String(Number(d.version) + 1);
    return meta(d);
  },
  async deleteDocument(config: { id: string }) {
    window.__docs = window.__docs.filter((x) => x.id !== config.id);
  },
};
